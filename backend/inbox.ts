import { ApplicationError } from './application-error';
import { methodNotAllowed, withApplicationUser } from './application-api';
import type { AccessData, PagesEnv } from './env';
import { json } from './response';
import { requireSameOrigin } from './same-origin';
import { resolveExchangeInbox } from './exchange-v2/inbox';

type Context={request:Request;env:PagesEnv;data:AccessData;params:Record<string,string|string[]>};
type InboxRow={id:string;kind:string;source_type:string;source_id:string;created_at:string;read_at:string|null;
  event_type:string|null;flight_id:string|null;flightlogger_booking_id:string|null;starts_at_snapshot:string|null;
  ends_at_snapshot:string|null;flight_starts_at_snapshot:string|null;flight_ends_at_snapshot:string|null;
  aircraft_callsign_snapshot:string|null;aircraft_model_snapshot:string|null;status_snapshot:string|null};
type ChangeRow={event_id:string;field:string;old_value:string|null;new_value:string|null;old_label:string|null;new_label:string|null;
  old_detail:string|null;new_detail:string|null};
const invalid=()=>new ApplicationError('Invalid Inbox request.',400,'INVALID_INBOX_REQUEST');
const cursorPattern=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\|([a-f0-9]{32})$/;
const encodeCursor=(row:InboxRow)=>btoa(`${row.created_at}|${row.id}`).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function decodeCursor(value:string){
  if(value.length>120||!/^[-_A-Za-z0-9]+$/.test(value))throw invalid();
  let decoded:string;try{decoded=atob(value.replace(/-/g,'+').replace(/_/g,'/'));}catch{throw invalid();}
  const match=cursorPattern.exec(decoded);if(!match||Number.isNaN(Date.parse(match[1])))throw invalid();
  return {date:match[1],id:match[2]};
}
function title(type:string){return type==='CANCELLED'?'Flight cancelled':type==='RESTORED'?'Flight restored':
  type==='FLIGHT_ADDED'?'New flight added':type==='FLIGHT_REMOVED'?'Flight removed from your schedule':'Flight changed';}
function summary(type:string,changes:ChangeRow[]){
  if(type==='CANCELLED'||type==='RESTORED'||type==='FLIGHT_ADDED'||type==='FLIGHT_REMOVED')return null;
  const fields=new Set(changes.map(change=>change.field));
  const parts=[fields.has('FLIGHT_START')||fields.has('FLIGHT_END')||fields.has('BOOKING_START')||fields.has('BOOKING_END')?'Time':null,
    fields.has('AIRCRAFT')?'aircraft':null,fields.has('INSTRUCTOR')?'instructor':null,
    fields.has('DEPARTURE_AIRPORT')||fields.has('ARRIVAL_AIRPORT')?'airport':null].filter((part):part is string=>!!part);
  return parts.length?`${parts.join(' and ')} changed`:'Flight details changed';
}
export async function listInbox(db:D1Database,userId:string,url:URL){
  if([...url.searchParams.keys()].some(key=>key!=='limit'&&key!=='cursor')||url.searchParams.getAll('limit').length>1||
    url.searchParams.getAll('cursor').length>1)throw invalid();
  const rawLimit=url.searchParams.get('limit');
  if(rawLimit!==null && (!/^[1-9]\d?$/.test(rawLimit)||Number(rawLimit)>50))throw invalid();
  const limit=rawLimit===null?30:Number(rawLimit),rawCursor=url.searchParams.get('cursor');
  const cursor=rawCursor===null?null:decodeCursor(rawCursor);
  const {results}=await db.prepare(`SELECT i.*,e.type event_type,e.flight_id,e.flightlogger_booking_id,e.starts_at_snapshot,
    e.ends_at_snapshot,e.flight_starts_at_snapshot,e.flight_ends_at_snapshot,e.aircraft_callsign_snapshot,
    e.aircraft_model_snapshot,e.status_snapshot
    FROM user_inbox_items i LEFT JOIN flight_change_events e ON i.source_type='FLIGHT_CHANGE' AND e.id=i.source_id
    WHERE i.user_id=? AND (? IS NULL OR i.created_at<? OR (i.created_at=? AND i.id<?))
    ORDER BY i.created_at DESC,i.id DESC LIMIT ?`)
    .bind(userId,cursor?.date??null,cursor?.date??null,cursor?.date??null,cursor?.id??null,limit+1).all<InboxRow>();
  const page=results.slice(0,limit),eventIds=page.filter(row=>row.source_type==='FLIGHT_CHANGE').map(row=>row.source_id);
  const {results:changes}=eventIds.length?await db.prepare(`SELECT event_id,field,old_value,new_value,old_label,new_label,old_detail,new_detail
    FROM flight_change_items WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY event_id,field`)
    .bind(JSON.stringify(eventIds)).all<ChangeRow>():{results:[] as ChangeRow[]};
  const byEvent=new Map<string,ChangeRow[]>();for(const change of changes){const group=byEvent.get(change.event_id)??[];group.push(change);byEvent.set(change.event_id,group);}
  const exchanges=await resolveExchangeInbox(db,page.filter(row=>row.source_type==='EXCHANGE').map(row=>row.source_id),userId);
  const unread=await db.prepare('SELECT count(*) total FROM user_inbox_items WHERE user_id=? AND read_at IS NULL').bind(userId).first<{total:number}>();
  return {items:page.map(row=>{
    const eventChanges=byEvent.get(row.source_id)??[];
    if(row.source_type==='EXCHANGE'){
      const source=exchanges.get(row.source_id);
      return {id:row.id,kind:row.kind,createdAt:row.created_at,readAt:row.read_at,
        title:source?.title??'Exchange no longer available',summary:source?.summary??null,
        target:source?.target??null,flight:null,changes:[]};
    }
    if(row.source_type!=='FLIGHT_CHANGE'||!row.event_type)return {id:row.id,kind:row.kind,createdAt:row.created_at,
      readAt:row.read_at,title:'Inbox item',summary:null,target:null,flight:null,changes:[]};
    return {id:row.id,kind:row.kind,createdAt:row.created_at,readAt:row.read_at,
      title:title(row.event_type),summary:summary(row.event_type,eventChanges),
      target:{path:'/flights',flightId:row.flight_id},
      flight:{bookingId:row.flightlogger_booking_id,startsAt:row.flight_starts_at_snapshot??row.starts_at_snapshot,
        endsAt:row.flight_ends_at_snapshot??row.ends_at_snapshot,callSign:row.aircraft_callsign_snapshot,
        model:row.aircraft_model_snapshot,status:row.status_snapshot,timeZone:'Europe/Oslo'},
      changes:eventChanges.map(change=>({field:change.field,oldValue:change.old_value,newValue:change.new_value,
        oldLabel:change.old_label,newLabel:change.new_label,oldDetail:change.old_detail,newDetail:change.new_detail}))};
  }),unreadCount:unread?.total??0,nextCursor:results.length>limit?encodeCursor(page[page.length-1]):null};
}

export function inboxEndpoint(context:Context):Promise<Response>|Response{
  if(context.request.method!=='GET')return methodNotAllowed('GET');
  return withApplicationUser(context,async(db,user)=>json(await listInbox(db,user.id,new URL(context.request.url))));
}
export function markInboxReadEndpoint(context:Context):Promise<Response>|Response{
  if(context.request.method!=='POST')return methodNotAllowed('POST');
  return withApplicationUser(context,async(db,user)=>{
    requireSameOrigin(context.request);
    if(new URL(context.request.url).search||context.request.body!==null||
      (context.request.headers.has('Content-Length')&&Number(context.request.headers.get('Content-Length'))>0))throw invalid();
    const id=context.params.itemId;
    if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw invalid();
    await db.prepare('UPDATE user_inbox_items SET read_at=coalesce(read_at,?) WHERE id=? AND user_id=?')
      .bind(new Date().toISOString(),id,user.id).run();
    const item=await db.prepare('SELECT id,read_at FROM user_inbox_items WHERE id=? AND user_id=?').bind(id,user.id)
      .first<{id:string;read_at:string}>();
    if(!item)throw new ApplicationError('Inbox item not found.',404,'INBOX_ITEM_NOT_FOUND');
    return json({id:item.id,readAt:item.read_at});
  });
}
