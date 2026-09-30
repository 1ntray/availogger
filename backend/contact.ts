import { ApplicationError } from './application-error';
import { methodNotAllowed, withApplicationUser, withAuthorizedUser } from './application-api';
import type { AccessData, PagesEnv } from './env';
import { json } from './response';
import { requireSameOrigin } from './same-origin';
import type { ApplicationUser } from './users';
import { PERMISSIONS } from '../shared/authorization';
import { contactNoticeStatements } from './notifications/contact';

type Context = { request: Request; env: PagesEnv; data: AccessData; params: Record<string,string|string[]> };
type Thread = { id:string;channel_id:string;category:string;title:string;current_path:string|null;status:'OPEN'|'RESOLVED';created_at:string;updated_at:string;resolved_at:string|null;created_by_user_id:string;first_name:string|null;last_name:string|null;email:string };
type Message = { id:string;author_user_id:string;body:string;created_at:string;first_name:string|null;last_name:string|null };
const categories = ['BUG','IMPROVEMENT','IDEA','OTHER'] as const;
const labels: Record<string,string> = {BUG:'Bug',IMPROVEMENT:'Improvement',IDEA:'Idea',OTHER:'Other'};
const invalid = (message='Invalid contact request.') => new ApplicationError(message,400,'INVALID_CONTACT_REQUEST');
const notFound = () => new ApplicationError('Message thread not found.',404,'CONTACT_NOT_FOUND');
const threadId = (value: string|string[]|undefined) => { if(typeof value!=='string'||!/^[a-f0-9]{32}$/.test(value)) throw invalid(); return value; };
const hexId = () => crypto.randomUUID().replace(/-/g,'');
const normalizedBody = (value:unknown) => {
  if(typeof value!=='string') throw invalid('Enter a message.');
  const body=value.trim();
  if(!body||body.length>4000) throw invalid('Enter a message of 1–4000 characters.');
  return body;
};
async function input(request:Request,keys:string[]):Promise<Record<string,unknown>> {
  requireSameOrigin(request);
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json') || Number(request.headers.get('Content-Length')||0)>10000) throw invalid();
  const raw=await request.text();
  if(raw.length>10000) throw invalid();
  let value:unknown;try{value=JSON.parse(raw);}catch{throw invalid();}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw invalid();
  return value as Record<string,unknown>;
}
function path(value:unknown):string|null {
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||value.length>256||!value.startsWith('/')||value.startsWith('//')||/[?#\\\r\n\x00-\x1f]/.test(value))throw invalid('Use a page path within this portal.');
  return value;
}
function presentThread(row:Thread){return {id:row.id,channelId:row.channel_id,category:row.category,title:row.title,currentPath:row.current_path,
  status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,resolvedAt:row.resolved_at,
  author:{id:row.created_by_user_id,firstName:row.first_name,lastName:row.last_name,email:row.email}};}
function presentMessage(row:Message){return {id:row.id,body:row.body,createdAt:row.created_at,author:{id:row.author_user_id,firstName:row.first_name,lastName:row.last_name}};}
const columns=`t.*,u.flightlogger_first_name first_name,u.flightlogger_last_name last_name,u.email`;
const joins=`contact_threads t JOIN users u ON u.id=t.created_by_user_id`;
async function getThread(db:D1Database,id:string,user:ApplicationUser,admin=false){
  const row=await db.prepare(`SELECT ${columns} FROM ${joins} WHERE t.id=? AND (${admin?`EXISTS(SELECT 1 FROM effective_user_permissions p JOIN contact_channels c ON c.recipient_permission_key=p.permission_key WHERE p.user_id=? AND c.id=t.channel_id)`:'t.created_by_user_id=?'})`).bind(id,user.id).first<Thread>();
  if(!row)throw notFound();return row;
}
export async function createContact(db:D1Database,user:ApplicationUser,category:unknown,bodyValue:unknown,currentPath:unknown){
  if(typeof category!=='string'||!categories.includes(category as typeof categories[number]))throw invalid('Choose a category.');
  const body=normalizedBody(bodyValue),route=path(currentPath),now=new Date().toISOString(),id=hexId();
  const channel=await db.prepare("SELECT id FROM contact_channels WHERE id='webmaster' AND active=1 AND user_facing=1").first();
  if(!channel)throw new ApplicationError('Feedback is unavailable right now.',503,'CONTACT_UNAVAILABLE');
  const preview=body.replace(/\s+/g,' ').slice(0,78);
  const title=`${labels[category]}: ${preview}${body.replace(/\s+/g,' ').length>78?'…':''}`;
  await db.batch([
    db.prepare("UPDATE contact_state SET revision=CASE WHEN EXISTS(SELECT 1 FROM contact_channels WHERE id='webmaster' AND active=1 AND user_facing=1) THEN revision+1 ELSE -1 END WHERE id=1"),
    db.prepare("INSERT INTO contact_threads (id,channel_id,created_by_user_id,category,title,current_path,status,created_at,updated_at) VALUES (?,'webmaster',?,?,?,?,'OPEN',?,?)").bind(id,user.id,category,title,route,now,now),
    db.prepare('INSERT INTO contact_messages (id,thread_id,author_user_id,body,created_at) VALUES (?,?,?,?,?)').bind(hexId(),id,user.id,body,now),
    ...contactNoticeStatements(db,id,user.id,'NEW_FEEDBACK',null,now),
  ]);
  return {id,title};
}
export async function replyContact(db:D1Database,user:ApplicationUser,id:string,bodyValue:unknown,admin=false){
  const body=normalizedBody(bodyValue),thread=await getThread(db,id,user,admin),now=new Date().toISOString(),messageId=hexId();
  const count=await db.prepare('SELECT count(*) total FROM contact_messages WHERE thread_id=?').bind(id).first<{total:number}>();
  if((count?.total??0)>=200)throw new ApplicationError('This conversation is full. Please start a new message.',409,'CONTACT_THREAD_FULL');
  const guard=admin?`EXISTS(SELECT 1 FROM effective_user_permissions p JOIN contact_channels c ON c.recipient_permission_key=p.permission_key WHERE p.user_id=? AND c.id=t.channel_id)`:'t.created_by_user_id=?';
  const statements=[
    db.prepare(`UPDATE contact_state SET revision=CASE WHEN EXISTS(SELECT 1 FROM contact_threads t WHERE t.id=? AND ${guard} AND (SELECT count(*) FROM contact_messages WHERE thread_id=t.id)<200) THEN revision+1 ELSE -1 END WHERE id=1`).bind(id,user.id),
    db.prepare('INSERT INTO contact_messages (id,thread_id,author_user_id,body,created_at) VALUES (?,?,?,?,?)').bind(messageId,id,user.id,body,now),
    db.prepare("UPDATE contact_threads SET updated_at=?,status='OPEN',resolved_at=NULL,resolved_by_user_id=NULL"+(admin?',last_webmaster_message_id=?':'')+' WHERE id=?').bind(...(admin?[now,messageId,id]:[now,id])),
  ];
  statements.push(...contactNoticeStatements(db,id,user.id,admin?'WEBMASTER_REPLY':'STUDENT_REPLY',messageId,now));
  await db.batch(statements);
  return {id:messageId,createdAt:now};
}
function listQuery(url:URL,admin:boolean){
  if([...url.searchParams.keys()].some(k=>!['status','limit','cursor'].includes(k))||['status','limit','cursor'].some(k=>url.searchParams.getAll(k).length>1))throw invalid();
  const status=url.searchParams.get('status');if(status!==null&&(!admin||!['OPEN','RESOLVED'].includes(status)))throw invalid();
  const rawLimit=url.searchParams.get('limit');if(rawLimit!==null&&(!/^[1-9]\d?$/.test(rawLimit)||Number(rawLimit)>50))throw invalid();
  const rawCursor=url.searchParams.get('cursor');let cursor:{date:string;id:string}|null=null;
  if(rawCursor!==null){let decoded:string;try{decoded=atob(rawCursor.replace(/-/g,'+').replace(/_/g,'/'));}catch{throw invalid();}
    const match=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)\|([a-f0-9]{32})$/.exec(decoded);if(!match||rawCursor.length>120||!/^[-_A-Za-z0-9]+$/.test(rawCursor))throw invalid();cursor={date:match[1],id:match[2]};}
  return {status,limit:rawLimit?Number(rawLimit):30,cursor};
}
async function listThreads(db:D1Database,user:ApplicationUser,url:URL,admin=false){
  const {status,limit,cursor}=listQuery(url,admin);
  const access=admin?`EXISTS(SELECT 1 FROM effective_user_permissions p JOIN contact_channels c ON c.recipient_permission_key=p.permission_key WHERE p.user_id=? AND c.id=t.channel_id)`:'t.created_by_user_id=?';
  const {results}=await db.prepare(`SELECT ${columns} FROM ${joins} WHERE ${access} AND (? IS NULL OR t.status=?) AND (? IS NULL OR t.updated_at<? OR (t.updated_at=? AND t.id<?)) ORDER BY t.updated_at DESC,t.id DESC LIMIT ?`)
    .bind(user.id,status,status,cursor?.date??null,cursor?.date??null,cursor?.date??null,cursor?.id??null,limit+1).all<Thread>();
  const page=results.slice(0,limit),last=page.at(-1);
  return {threads:page.map(presentThread),nextCursor:results.length>limit&&last?btoa(`${last.updated_at}|${last.id}`).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):null};
}
async function detail(db:D1Database,user:ApplicationUser,id:string,admin=false){
  const thread=await getThread(db,id,user,admin);
  const {results}=await db.prepare(`SELECT m.*,u.flightlogger_first_name first_name,u.flightlogger_last_name last_name FROM contact_messages m JOIN users u ON u.id=m.author_user_id WHERE m.thread_id=? ORDER BY m.created_at,m.id LIMIT 201`).bind(id).all<Message>();
  return {thread:presentThread(thread),messages:results.slice(0,200).map(presentMessage),hasMore:results.length>200};
}
export function contactCollectionEndpoint(context:Context,admin=false):Promise<Response>|Response{
  const method=context.request.method;if(method!=='GET'&&method!=='POST')return methodNotAllowed('GET, POST');
  const work=async(db:D1Database,user:ApplicationUser)=>{
    if(method==='GET')return json(await listThreads(db,user,new URL(context.request.url),admin));
    if(admin)return methodNotAllowed('GET');
    const data=await input(context.request,['category','body','currentPath']);
    return json(await createContact(db,user,data.category,data.body,data.currentPath),201);
  };
  return admin?withAuthorizedUser(context,PERMISSIONS.contactWebmasterManage,work):withApplicationUser(context,work);
}
export function contactThreadEndpoint(context:Context,admin=false):Promise<Response>|Response{
  if(context.request.method!=='GET')return methodNotAllowed('GET');
  const work=(db:D1Database,user:ApplicationUser)=>detail(db,user,threadId(context.params.threadId),admin).then(json);
  return admin?withAuthorizedUser(context,PERMISSIONS.contactWebmasterManage,work):withApplicationUser(context,work);
}
export function contactReplyEndpoint(context:Context,admin=false):Promise<Response>|Response{
  if(context.request.method!=='POST')return methodNotAllowed('POST');
  const work=async(db:D1Database,user:ApplicationUser)=>{const data=await input(context.request,['body']);return json(await replyContact(db,user,threadId(context.params.threadId),data.body,admin),201);};
  return admin?withAuthorizedUser(context,PERMISSIONS.contactWebmasterManage,work):withApplicationUser(context,work);
}
export function contactStatusEndpoint(context:Context):Promise<Response>|Response{
  if(context.request.method!=='POST')return methodNotAllowed('POST');
  return withAuthorizedUser(context,PERMISSIONS.contactWebmasterManage,async(db,user)=>{
    const data=await input(context.request,['status']);if(data.status!=='OPEN'&&data.status!=='RESOLVED')throw invalid();
    const id=threadId(context.params.threadId),thread=await getThread(db,id,user,true);
    if(thread.status===data.status)return json({status:data.status});
    const now=new Date().toISOString();
    await db.batch([
      db.prepare(`UPDATE contact_state SET revision=CASE WHEN EXISTS(SELECT 1 FROM contact_threads t JOIN contact_channels c ON c.id=t.channel_id JOIN effective_user_permissions p ON p.permission_key=c.recipient_permission_key AND p.user_id=? WHERE t.id=? AND t.status=?) THEN revision+1 ELSE -1 END WHERE id=1`).bind(user.id,id,thread.status),
      db.prepare('UPDATE contact_threads SET status=?,resolved_at=?,resolved_by_user_id=?,updated_at=? WHERE id=?').bind(data.status,data.status==='RESOLVED'?now:null,data.status==='RESOLVED'?user.id:null,now,id),
      db.prepare('INSERT INTO contact_thread_events(id,thread_id,actor_user_id,type,created_at) VALUES (?,?,?,?,?)')
        .bind(hexId(),id,user.id,data.status==='RESOLVED'?'RESOLVED':'REOPENED',now),
      ...contactNoticeStatements(db,id,user.id,data.status==='RESOLVED'?'RESOLVED':'REOPENED',null,now),
    ]);
    return json({status:data.status});
  });
}
