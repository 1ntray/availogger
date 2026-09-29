import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { createTestDatabase,seedCredential,testEncryptionKey } from './d1-fixture';
import { contactCollectionEndpoint,contactReplyEndpoint,contactStatusEndpoint,contactThreadEndpoint } from '../backend/contact';
import { inboxEndpoint,markInboxReadEndpoint,listInbox } from '../backend/inbox';
import { getEffectivePermissions } from '../backend/authorization';
import { PERMISSIONS } from '../shared/authorization';
import type { ApplicationUser } from '../backend/users';

type Endpoint=(context:any)=>Response|Promise<Response>;
describe('contact and Inbox',()=>{
  let fixture:Awaited<ReturnType<typeof createTestDatabase>>,db:D1Database,student:ApplicationUser,other:ApplicationUser,admin:ApplicationUser;
  beforeEach(async()=>{fixture=await createTestDatabase();db=fixture.db;
    student=await seedCredential(db,'contact-student','token','student@example.test');
    other=await seedCredential(db,'contact-other','token','other@example.test');
    admin=await seedCredential(db,'contact-admin','token','admin@example.test');
    await db.prepare("INSERT INTO user_roles (user_id,role_id,created_at) VALUES (?,'system-admin',?)").bind(admin.id,new Date().toISOString()).run();
  });
  afterEach(async()=>{await fixture.dispose();});
  async function call(fn:Endpoint,user:ApplicationUser,method:string,path:string,body?:object,params:Record<string,string>={}){
    const request=new Request(`https://portal.test${path}`,{method,headers:method==='GET'?{}:{Origin:'https://portal.test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return fn({request,env:{DB:db,FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY:testEncryptionKey},data:{accessIdentity:{subject:user.access_subject,email:user.email}},params});
  }
  async function create(body='Something is broken',currentPath:string|null='/flights'){
    const response=await call(contactCollectionEndpoint,student,'POST','/api/contact',{category:'BUG',body,currentPath});
    expect(response.status).toBe(201);return (await response.json() as {id:string}).id;
  }
  it('creates title from category and text, with optional bounded route and no required subject',async()=>{
    const id=await create('  <script>alert(1)</script>  ',null);
    const row=await db.prepare('SELECT title,current_path FROM contact_threads WHERE id=?').bind(id).first<{title:string;current_path:string|null}>();
    expect(row).toEqual({title:'Bug: <script>alert(1)</script>',current_path:null});
    const detail=await call(contactThreadEndpoint,student,'GET',`/api/contact/${id}`,undefined,{threadId:id});
    expect(detail.status).toBe(200);expect(JSON.stringify(await detail.json())).toContain('<script>alert(1)</script>');
    const invalidPath=await call(contactCollectionEndpoint,student,'POST','/api/contact',{category:'BUG',body:'hi',currentPath:'https://evil.test'});
    expect(invalidPath.status).toBe(400);
    const excess=await call(contactCollectionEndpoint,student,'POST','/api/contact',{category:'BUG',body:'x'.repeat(4001)});
    expect(excess.status).toBe(400);
    const extra=await call(contactCollectionEndpoint,student,'POST','/api/contact',{category:'BUG',body:'hi',recipient:'contact-admin'});
    expect(extra.status).toBe(400);
  });
  it('keeps student threads private, lets owner reply, and denies webmaster operations without permission',async()=>{
    const id=await create();
    expect((await call(contactThreadEndpoint,other,'GET',`/api/contact/${id}`,undefined,{threadId:id})).status).toBe(404);
    expect((await call(contactReplyEndpoint,other,'POST',`/api/contact/${id}/reply`,{body:'No'}, {threadId:id})).status).toBe(404);
    expect((await call(context=>contactCollectionEndpoint(context,true),other,'GET','/api/admin/contact')).status).toBe(403);
    expect((await call(contactStatusEndpoint,other,'POST',`/api/admin/contact/${id}/status`,{status:'RESOLVED'},{threadId:id})).status).toBe(403);
    expect((await call(contactReplyEndpoint,student,'POST',`/api/contact/${id}/reply`,{body:'More detail'}, {threadId:id})).status).toBe(201);
    expect(await db.prepare('SELECT count(*) n FROM contact_messages WHERE thread_id=?').bind(id).first<number>('n')).toBe(2);
    expect((await listInbox(db,student.id,new URL('https://portal.test/api/inbox'))).unreadCount).toBe(0);
  });
  it('lets webmaster filter, reply, resolve and reopen; coalesces unread replies',async()=>{
    const id=await create();expect(await getEffectivePermissions(db,admin)).toContain(PERMISSIONS.contactWebmasterManage);
    const adminList=await call(context=>contactCollectionEndpoint(context,true),admin,'GET','/api/admin/contact?status=OPEN');
    expect((await adminList.json() as {threads:{id:string}[]}).threads[0].id).toBe(id);
    expect((await call(context=>contactThreadEndpoint(context,true),admin,'GET',`/api/admin/contact/${id}`,undefined,{threadId:id})).status).toBe(200);
    for(const body of ['First answer','Second answer'])expect((await call(context=>contactReplyEndpoint(context,true),admin,'POST',`/api/admin/contact/${id}/reply`,{body},{threadId:id})).status).toBe(201);
    const inbox=await listInbox(db,student.id,new URL('https://portal.test/api/inbox'));
    expect(inbox.unreadCount).toBe(1);expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toMatchObject({sourceType:'CONTACT_MESSAGE',summary:'Second answer',target:{path:`/messages/${id}`}});
    const itemId=inbox.items[0].id;
    expect((await call(markInboxReadEndpoint,student,'POST',`/api/inbox/${itemId}/read`,undefined,{itemId})).status).toBe(200);
    expect((await listInbox(db,student.id,new URL('https://portal.test/api/inbox'))).unreadCount).toBe(0);
    expect((await call(contactStatusEndpoint,admin,'POST',`/api/admin/contact/${id}/status`,{status:'RESOLVED'},{threadId:id})).status).toBe(200);
    expect((await db.prepare('SELECT status FROM contact_threads WHERE id=?').bind(id).first('status'))).toBe('RESOLVED');
    expect((await call(contactReplyEndpoint,student,'POST',`/api/contact/${id}/reply`,{body:'Still an issue'},{threadId:id})).status).toBe(201);
    expect((await db.prepare('SELECT status FROM contact_threads WHERE id=?').bind(id).first('status'))).toBe('OPEN');
    expect((await listInbox(db,student.id,new URL('https://portal.test/api/inbox'))).unreadCount).toBe(0);
    expect((await call(contactStatusEndpoint,admin,'POST',`/api/admin/contact/${id}/status`,{status:'RESOLVED'},{threadId:id})).status).toBe(200);
    expect((await call(contactStatusEndpoint,admin,'POST',`/api/admin/contact/${id}/status`,{status:'OPEN'},{threadId:id})).status).toBe(200);
  });
  it('paginates mixed Inbox, isolates other users and tolerates missing sources',async()=>{
    const ids=[await create('One'),await create('Two')];
    for(const id of ids)expect((await call(context=>contactReplyEndpoint(context,true),admin,'POST',`/api/admin/contact/${id}/reply`,{body:'Reply'},{threadId:id})).status).toBe(201);
    const page=await listInbox(db,student.id,new URL('https://portal.test/api/inbox?limit=1'));
    expect(page.items).toHaveLength(1);expect(page.nextCursor).toBeTruthy();
    const next=await listInbox(db,student.id,new URL(`https://portal.test/api/inbox?limit=1&cursor=${page.nextCursor}`));
    expect(next.items).toHaveLength(1);expect(next.items[0].id).not.toBe(page.items[0].id);
    expect((await listInbox(db,other.id,new URL('https://portal.test/api/inbox'))).items).toHaveLength(0);
    expect((await call(markInboxReadEndpoint,other,'POST',`/api/inbox/${page.items[0].id}/read`,undefined,{itemId:page.items[0].id})).status).toBe(404);
    await db.prepare("INSERT INTO user_inbox_items VALUES (lower(hex(randomblob(16))),?,'UNKNOWN','UNKNOWN','gone',?,NULL)").bind(student.id,new Date().toISOString()).run();
    await db.prepare("INSERT INTO user_inbox_items VALUES (lower(hex(randomblob(16))),?,'EXCHANGE_ACTION','EXCHANGE','missing-exchange',?,NULL)").bind(student.id,new Date().toISOString()).run();
    const mixed=(await listInbox(db,student.id,new URL('https://portal.test/api/inbox'))).items;
    expect(mixed.some(item=>item.title==='Inbox item unavailable')).toBe(true);
    expect(mixed.some(item=>item.sourceType==='EXCHANGE'&&item.title==='Exchange no longer available'&&item.target===null)).toBe(true);
    expect(mixed.some(item=>item.sourceType==='CONTACT_MESSAGE'&&item.target!==null)).toBe(true);
  });
});
