import { ApplicationError } from '../application-error';
import { methodNotAllowed, withAuthorizedUser } from '../application-api';
import type { AccessData, PagesEnv } from '../env';
import { json } from '../response';
import { PERMISSIONS } from '../../shared/authorization';
import { exchangeId } from './service';

type Context={request:Request;env:PagesEnv;data:AccessData;params:Record<string,string|string[]>};
const invalid=()=>new ApplicationError('Use valid Exchange audit filters.',400,'INVALID_EXCHANGE_AUDIT');
function filters(url:URL){
  const allowed=new Set(['person','domain','status','from','to']);
  if([...url.searchParams.keys()].some(key=>!allowed.has(key)||url.searchParams.getAll(key).length!==1))throw invalid();
  const person=url.searchParams.get('person')?.trim()??'',domain=url.searchParams.get('domain')??'',
    status=url.searchParams.get('status')??'',from=url.searchParams.get('from')??'',to=url.searchParams.get('to')??'';
  if(person.length>80||!['','DUTY_OPS','FLYVASK','BRAKKEVAKT'].includes(domain)||
    !['','OPEN','COMPLETED','CANCELLED','SUPERSEDED','INVALIDATED','EXPIRED'].includes(status)||
    [from,to].some(value=>value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(`${value}T00:00:00Z`))||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value))||
    (from&&to&&from>to))throw invalid();
  return {person,domain,status,from,to};
}
const person=(id:string,first:string|null,last:string|null)=>({id,firstName:first,lastName:last});
export async function listAudit(db:D1Database,url:URL){
  const f=filters(url);
  const rows=await db.prepare(`SELECT i.id,i.domain,i.status,i.reason,i.created_at,i.updated_at,
    i.source_snapshot,i.allow_give_away,i.completed_candidate_id,
    u.id owner_id,u.flightlogger_first_name first_name,u.flightlogger_last_name last_name,
    (SELECT count(*) FROM exchange_v2_candidate_intents ci WHERE ci.intent_id=i.id) candidate_count
    FROM exchange_v2_intents i JOIN users u ON u.id=i.owner_user_id
    WHERE (?='' OR i.domain=?) AND (?='' OR i.status=?)
      AND (?='' OR substr(i.created_at,1,10)>=?) AND (?='' OR substr(i.created_at,1,10)<=?)
      AND (?='' OR lower(COALESCE(u.flightlogger_first_name,'')||' '||COALESCE(u.flightlogger_last_name,'')) LIKE '%'||lower(?)||'%'
        OR u.id=? OR EXISTS(SELECT 1 FROM exchange_v2_candidate_intents ci
          JOIN exchange_v2_candidate_legs l ON l.candidate_id=ci.candidate_id JOIN users participant ON participant.id=l.user_id
          WHERE ci.intent_id=i.id AND (participant.id=? OR lower(COALESCE(participant.flightlogger_first_name,'')||' '||
            COALESCE(participant.flightlogger_last_name,'')) LIKE '%'||lower(?)||'%')))
    ORDER BY i.created_at DESC,i.id DESC LIMIT 100`)
    .bind(f.domain,f.domain,f.status,f.status,f.from,f.from,f.to,f.to,f.person,f.person,f.person,f.person,f.person)
    .all<{id:string;domain:string;status:string;reason:string|null;created_at:string;updated_at:string;
      source_snapshot:string;allow_give_away:number;completed_candidate_id:string|null;owner_id:string;
      first_name:string|null;last_name:string|null;candidate_count:number}>();
  return {cases:rows.results.map(r=>({id:r.id,domain:r.domain,status:r.status,reason:r.reason,
    createdAt:r.created_at,updatedAt:r.updated_at,source:JSON.parse(r.source_snapshot),
    allowGiveAway:!!r.allow_give_away,completedCandidateId:r.completed_candidate_id,
    owner:person(r.owner_id,r.first_name,r.last_name),candidateCount:r.candidate_count}))};
}
export async function auditCase(db:D1Database,id:string){
  const base=await db.prepare(`SELECT i.*,u.flightlogger_first_name first_name,u.flightlogger_last_name last_name
    FROM exchange_v2_intents i JOIN users u ON u.id=i.owner_user_id WHERE i.id=?`).bind(id)
    .first<{id:string;domain:string;status:string;reason:string|null;source_snapshot:string;created_at:string;
      owner_user_id:string;first_name:string|null;last_name:string|null}>();
  if(!base)throw new ApplicationError('Exchange case not found.',404,'EXCHANGE_NOT_FOUND');
  const [events,candidates,legs,credits]=await db.batch([
    db.prepare(`SELECT e.id,e.candidate_id,e.type,e.reason,e.snapshot,e.created_at,e.actor_user_id,
      u.flightlogger_first_name first_name,u.flightlogger_last_name last_name
      FROM exchange_v2_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.intent_id=?
      ORDER BY e.created_at,e.id`).bind(id),
    db.prepare(`SELECT c.id,c.status,c.reason,c.created_at,c.completed_at,c.caused_by_candidate_id
      FROM exchange_v2_candidates c JOIN exchange_v2_candidate_intents ci ON ci.candidate_id=c.id
      WHERE ci.intent_id=? ORDER BY c.created_at,c.id`).bind(id),
    db.prepare(`SELECT l.candidate_id,l.user_id,l.give_snapshot,l.receive_snapshot,l.consent_source,l.consented_at,
      u.flightlogger_first_name first_name,u.flightlogger_last_name last_name
      FROM exchange_v2_candidate_legs l JOIN users u ON u.id=l.user_id WHERE l.candidate_id IN
      (SELECT candidate_id FROM exchange_v2_candidate_intents WHERE intent_id=?) ORDER BY l.candidate_id,l.user_id`).bind(id),
    db.prepare(`SELECT c.candidate_id,c.user_id,c.amount,c.created_at,
      u.flightlogger_first_name first_name,u.flightlogger_last_name last_name
      FROM exchange_v2_credit_entries c JOIN users u ON u.id=c.user_id WHERE c.candidate_id IN
      (SELECT candidate_id FROM exchange_v2_candidate_intents WHERE intent_id=?) ORDER BY c.created_at,c.user_id`).bind(id),
  ]);
  type E={id:string;candidate_id:string|null;type:string;reason:string|null;snapshot:string;created_at:string;
    actor_user_id:string|null;first_name:string|null;last_name:string|null};
  type L={candidate_id:string;user_id:string;give_snapshot:string|null;receive_snapshot:string|null;
    consent_source:string|null;consented_at:string|null;first_name:string|null;last_name:string|null};
  type C={candidate_id:string;user_id:string;amount:number;created_at:string;first_name:string|null;last_name:string|null};
  return {id:base.id,domain:base.domain,status:base.status,reason:base.reason,createdAt:base.created_at,
    owner:person(base.owner_user_id,base.first_name,base.last_name),source:JSON.parse(base.source_snapshot),
    events:(events.results as E[]).map(e=>({id:e.id,candidateId:e.candidate_id,type:e.type,reason:e.reason,
      snapshot:JSON.parse(e.snapshot),createdAt:e.created_at,
      actor:e.actor_user_id?person(e.actor_user_id,e.first_name,e.last_name):null})),
    candidates:candidates.results.map(c=>({...(c as object),legs:(legs.results as L[])
      .filter(l=>l.candidate_id===(c as {id:string}).id).map(l=>({user:person(l.user_id,l.first_name,l.last_name),
        give:l.give_snapshot?JSON.parse(l.give_snapshot):null,receive:l.receive_snapshot?JSON.parse(l.receive_snapshot):null,
        consentSource:l.consent_source,consentedAt:l.consented_at}))})),
    credits:(credits.results as C[]).map(c=>({candidateId:c.candidate_id,user:person(c.user_id,c.first_name,c.last_name),
      amount:c.amount,createdAt:c.created_at}))};
}
export function auditEndpoint(context:Context,detail:boolean):Promise<Response>|Response{
  if(context.request.method!=='GET')return methodNotAllowed('GET');
  return withAuthorizedUser(context,PERMISSIONS.adminExchangeAudit,async(db)=>{
    if(detail){if(new URL(context.request.url).search)throw invalid();
      return json(await auditCase(db,exchangeId(context.params.intentId)));}
    return json(await listAudit(db,new URL(context.request.url)));
  });
}
