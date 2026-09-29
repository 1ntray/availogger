import { ApplicationError } from '../application-error';
import { methodNotAllowed, withApplicationUser } from '../application-api';
import type { AccessData, PagesEnv } from '../env';
import { getFlightLoggerCredential } from '../flightlogger-credentials';
import { loadDutyOps } from '../duty-ops/service';
import { dutyWindow } from '../duty-ops/window';
import { loadFlyvask } from '../flyvask/service';
import { flyvaskWindow } from '../flyvask/window';
import { json } from '../response';
import { requireSameOrigin } from '../same-origin';
import { requirePermission } from '../authorization';
import { PERMISSIONS } from '../../shared/authorization';
import type { ApplicationUser } from '../users';
import type { ExchangeDomain } from '../../shared/exchange-v2';
import { acceptTarget, cancelIntent, claimGiveAway, confirmCandidate, createIntent, createOffer,
  declineCandidate, exchangeId, generateMatches, withdrawOffer } from './service';
import { listExchangeV2 } from './read';
import { osloDay } from '../brakkevakt/week';

type Context={request:Request;env:PagesEnv;data:AccessData;params:Record<string,string|string[]>};
export type ExchangeV2Action='intents'|'cancel'|'acceptTarget'|'offer'|'withdrawOffer'|'claim'|'confirm'|'decline'|'matches';
const domainPermissions={DUTY_OPS:PERMISSIONS.dutyOpsSwap,FLYVASK:PERMISSIONS.flyvaskSwap,
  BRAKKEVAKT:PERMISSIONS.brakkevaktSwap} as const;
const viewPermissions={DUTY_OPS:PERMISSIONS.dutyOpsView,FLYVASK:PERMISSIONS.flyvaskView,
  BRAKKEVAKT:PERMISSIONS.brakkevaktView} as const;
const invalid=()=>new ApplicationError('Submit only valid Exchange fields.',400,'INVALID_EXCHANGE_REQUEST');
function domain(value:unknown):ExchangeDomain{
  if(value!=='DUTY_OPS'&&value!=='FLYVASK'&&value!=='BRAKKEVAKT')throw invalid();
  return value;
}
function param(context:Context,key:string):string{return exchangeId(context.params[key]);}
async function strictBody(request:Request,fields:string[]){
  requireSameOrigin(request);
  if(new URL(request.url).search)throw invalid();
  if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
    throw new ApplicationError('Submit Exchange changes as JSON.',415);
  if(Number(request.headers.get('Content-Length'))>8192)throw new ApplicationError('Exchange request is too large.',413);
  const reader=request.body?.getReader();if(!reader)throw invalid();
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;
    length+=value.byteLength;if(length>8192){await reader.cancel();throw new ApplicationError('Exchange request is too large.',413);}
    chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let parsed:unknown;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{throw invalid();}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length!==fields.length||
    !fields.every(field=>Object.hasOwn(parsed!,field)))throw invalid();
  return parsed as Record<string,unknown>;
}
async function refreshOwn(db:D1Database,user:ApplicationUser,
  env:PagesEnv,domain:ExchangeDomain,assignmentId:string){
  if(domain==='BRAKKEVAKT')return;
  const table=domain==='DUTY_OPS'?'duty_ops_shifts':'flyvask_shifts';
  const shift=await db.prepare(`SELECT starts_at FROM ${table} WHERE id=?`).bind(assignmentId).first<{starts_at:string}>();
  if(!shift)throw new ApplicationError('Assignment not found.',404,'EXCHANGE_ASSIGNMENT_NOT_FOUND');
  const day=osloDay(new Date(shift.starts_at)),url=new URL(`https://portal.invalid/?from=${day}&to=${day}`);
  const token=await getFlightLoggerCredential(db,user.id,env.FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY);
  if(domain==='DUTY_OPS'){
    const result=await loadDutyOps(db,user,token,dutyWindow(url),15);
    if(result.sync.stale)throw new ApplicationError('Refresh Duty Ops before exchanging.',503,'EXCHANGE_STALE');
  }else{
    const result=await loadFlyvask(db,user,token,flyvaskWindow(url),15);
    if(result.sync.stale)throw new ApplicationError('Refresh Flyvask before exchanging.',503,'EXCHANGE_STALE');
  }
}
async function ownedAssignmentFor(db:D1Database,action:ExchangeV2Action,id:string,userId:string){
  if(action==='acceptTarget')return db.prepare(`SELECT i.domain,t.assignment_id FROM exchange_v2_targets t
    JOIN exchange_v2_intents i ON i.id=t.intent_id WHERE t.id=?`).bind(id)
    .first<{domain:ExchangeDomain;assignment_id:string}>();
  if(action==='confirm')return db.prepare(`SELECT c.domain,l.give_assignment_id assignment_id FROM exchange_v2_candidate_legs l
    JOIN exchange_v2_candidates c ON c.id=l.candidate_id WHERE c.id=? AND l.user_id=?`)
    .bind(id,userId).first<{domain:ExchangeDomain;assignment_id:string|null}>();
  return null;
}
export function exchangeV2Endpoint(context:Context,action:ExchangeV2Action):Promise<Response>|Response{
  if(action==='intents'&&context.request.method==='GET'){
    return withApplicationUser(context,async(db,user)=>{
      const url=new URL(context.request.url),selected=domain(url.searchParams.get('domain'));
      if([...url.searchParams.keys()].some(key=>key!=='domain'&&key!=='assignmentIds')||
        url.searchParams.getAll('domain').length!==1||url.searchParams.getAll('assignmentIds').length>1)throw invalid();
      const ids=url.searchParams.get('assignmentIds')?.split(',').filter(Boolean)??[];
      if(ids.length>100||ids.some(id=>!/^[-a-f0-9]{36}$/i.test(id)))throw invalid();
      await requirePermission(db,user,viewPermissions[selected]);
      return json(await listExchangeV2(db,user,selected,ids));
    });
  }
  if(context.request.method!=='POST')return methodNotAllowed(action==='intents'?'GET, POST':'POST');
  return withApplicationUser(context,async(db,user)=>{
    const fields=action==='intents'?['domain','sourceAssignmentId','targetAssignmentIds','allowGiveAway']:
      action==='offer'?['assignmentId']:[];
    const body=await strictBody(context.request,fields);
    if(action==='intents'){
      const selected=domain(body.domain);await requirePermission(db,user,domainPermissions[selected]);
      if(!Array.isArray(body.targetAssignmentIds)||!body.targetAssignmentIds.every(x=>typeof x==='string')||
        typeof body.allowGiveAway!=='boolean')throw invalid();
      const sourceId=exchangeId(body.sourceAssignmentId);
      await refreshOwn(db,user,context.env,selected,sourceId);
      return json(await createIntent(db,user,selected,sourceId,body.targetAssignmentIds as string[],body.allowGiveAway),201);
    }
    const id=param(context,action==='acceptTarget'?'targetId':action==='withdrawOffer'?'offerId':
      action==='confirm'||action==='decline'?'candidateId':'intentId');
    let selected:ExchangeDomain;
    if(action==='acceptTarget'||action==='confirm'){
      const assignment=await ownedAssignmentFor(db,action,id,user.id);
      if(!assignment)throw new ApplicationError('Exchange not found.',404,'EXCHANGE_NOT_FOUND');
      selected=assignment.domain;await requirePermission(db,user,domainPermissions[selected]);
      if(assignment.assignment_id)await refreshOwn(db,user,context.env,selected,assignment.assignment_id);
    }else if(action==='withdrawOffer'){
      const record=await db.prepare(`SELECT i.domain,o.assignment_id FROM exchange_v2_offers o
        JOIN exchange_v2_intents i ON i.id=o.intent_id WHERE o.id=?`).bind(id)
        .first<{domain:ExchangeDomain;assignment_id:string}>();
      if(!record)throw new ApplicationError('Exchange not found.',404,'EXCHANGE_NOT_FOUND');
      selected=record.domain;await requirePermission(db,user,domainPermissions[selected]);
    }else if(action==='decline'){
      const record=await db.prepare('SELECT domain FROM exchange_v2_candidates WHERE id=?').bind(id)
        .first<{domain:ExchangeDomain}>();
      if(!record)throw new ApplicationError('Exchange not found.',404,'EXCHANGE_NOT_FOUND');
      selected=record.domain;await requirePermission(db,user,domainPermissions[selected]);
    }else{
      const record=await db.prepare('SELECT domain FROM exchange_v2_intents WHERE id=?').bind(id)
        .first<{domain:ExchangeDomain}>();
      if(!record)throw new ApplicationError('Exchange not found.',404,'EXCHANGE_NOT_FOUND');
      selected=record.domain;await requirePermission(db,user,domainPermissions[selected]);
    }
    if(action==='offer'){
      const offered=exchangeId(body.assignmentId);
      await refreshOwn(db,user,context.env,selected,offered);
      return json(await createOffer(db,user,id,offered),201);
    }
    const result=action==='cancel'?await cancelIntent(db,user,id):
      action==='acceptTarget'?await acceptTarget(db,user,id):
      action==='withdrawOffer'?await withdrawOffer(db,user,id):
      action==='claim'?await claimGiveAway(db,user,id):
      action==='confirm'?await confirmCandidate(db,user,id):
      action==='decline'?await declineCandidate(db,user,id):await generateMatches(db,user,id);
    return json(result);
  });
}
