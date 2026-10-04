import { ApplicationError } from '../application-error';
import type { ApplicationUser } from '../users';
import { PERMISSIONS } from '../../shared/authorization';
import type { ExchangeDomain, ExchangeLeg, ExchangeAssignmentSnapshot } from '../../shared/exchange-v2';
import { currentMemberPredicate, isExchangeable, legacyReservationPredicate, memberPredicateValues, readMembers, readOwned, snapshot,
  type AssignmentMember } from './assignments';
import { findDirectMatches, findThreeWayCycles, matchKey, type MatchIntent } from './matching';
import { reconcileExchangeV2IfInstalled } from './reconciliation';
import { assignmentConflict, hasAssignmentConflict } from '../assignment-reconciliation';

type IntentRow = { id:string;domain:ExchangeDomain;owner_user_id:string;source_assignment_id:string;
  source_snapshot:string;source_version:string;allow_give_away:number;status:string;created_at:string };
type TargetRow = { id:string;intent_id:string;assignment_id:string;assignment_snapshot:string;status:string };
type OfferRow = { id:string;intent_id:string;offerer_user_id:string;assignment_id:string;assignment_snapshot:string;status:string };
type CandidateRow = { id:string;domain:ExchangeDomain;intent_id:string;offer_id:string|null;target_id:string|null;status:string };
type LegRow = { candidate_id:string;user_id:string;give_assignment_id:string|null;receive_assignment_id:string|null;
  give_version:string|null;receive_version:string|null;give_snapshot:string|null;receive_snapshot:string|null;
  consent_source:ExchangeLeg['consentSource'];consented_at:string|null };
const permissions:Record<ExchangeDomain,string> = {
  DUTY_OPS:PERMISSIONS.dutyOpsSwap, FLYVASK:PERMISSIONS.flyvaskSwap, BRAKKEVAKT:PERMISSIONS.brakkevaktSwap,
};
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const exchangeId=(value:unknown):string=>{
  if(typeof value!=='string'||!idPattern.test(value))throw new ApplicationError('Use a valid Exchange ID.',400,'INVALID_EXCHANGE_ID');
  return value;
};
const nowStamp=()=>new Date().toISOString();
const conflict=(reason='EXCHANGE_CHANGED')=>new ApplicationError('This exchange changed. Reload and try again.',409,reason);
function sameAssignmentSnapshot(saved:string,current:AssignmentMember){
  try{const value=JSON.parse(saved) as {id:string;startsAt:string;endsAt:string;status:string};
    return value.id===current.id&&value.startsAt===current.startsAt&&value.endsAt===current.endsAt&&value.status===current.status;
  }catch{return false;}
}
const event=(db:D1Database,intentId:string|null,candidateId:string|null,actorId:string|null,type:string,
  data:unknown,now:string,reason:string|null=null)=>db.prepare(`INSERT INTO exchange_v2_events
    (id,intent_id,candidate_id,actor_user_id,type,reason,snapshot,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(),intentId,candidateId,actorId,type,reason,JSON.stringify(data),now);
const candidateEvent=(db:D1Database,candidateId:string,actorId:string|null,type:string,
  data:unknown,now:string,reason:string|null=null)=>db.prepare(`INSERT INTO exchange_v2_events
    SELECT lower(hex(randomblob(16))),ci.intent_id,?, ?,?,?,?,?
    FROM exchange_v2_candidate_intents ci WHERE ci.candidate_id=?`)
    .bind(candidateId,actorId,type,reason,JSON.stringify(data),now,candidateId);
const permissionPredicate=(domain:ExchangeDomain)=>`EXISTS(SELECT 1 FROM effective_user_permissions
  WHERE user_id=? AND permission_key='${permissions[domain]}')`;
async function guarded(db:D1Database,domain:ExchangeDomain,actorId:string,predicate:string,values:unknown[],writes:D1PreparedStatement[]) {
  try {
    await db.batch([db.prepare(`UPDATE exchange_v2_state SET revision=CASE WHEN ${permissionPredicate(domain)}
      AND (${predicate}) THEN revision+1 ELSE -1 END WHERE id=1`).bind(actorId,...values),...writes]);
  } catch {
    if (domain !== 'BRAKKEVAKT') {
      const ids=values.filter((value):value is string=>typeof value==='string');
      if(await hasAssignmentConflict(db,domain,ids) || await db.prepare(`SELECT 1 FROM assignment_reconciliation r
        JOIN exchange_v2_candidate_legs l ON l.give_assignment_id=r.shift_id
        WHERE r.domain=? AND r.status='CONFLICT' AND l.candidate_id IN (SELECT value FROM json_each(?)) LIMIT 1`)
        .bind(domain,JSON.stringify(ids)).first())throw assignmentConflict();
    }
    throw conflict();
  }
}
async function intent(db:D1Database,id:string):Promise<IntentRow>{
  const row=await db.prepare('SELECT * FROM exchange_v2_intents WHERE id=?').bind(id).first<IntentRow>();
  if(!row)throw new ApplicationError('Exchange intent not found.',404,'EXCHANGE_NOT_FOUND');
  return row;
}
async function target(db:D1Database,id:string):Promise<TargetRow>{
  const row=await db.prepare('SELECT * FROM exchange_v2_targets WHERE id=?').bind(id).first<TargetRow>();
  if(!row)throw new ApplicationError('Exchange target not found.',404,'EXCHANGE_TARGET_NOT_FOUND');
  return row;
}
async function offer(db:D1Database,id:string):Promise<OfferRow>{
  const row=await db.prepare('SELECT * FROM exchange_v2_offers WHERE id=?').bind(id).first<OfferRow>();
  if(!row)throw new ApplicationError('Exchange offer not found.',404,'EXCHANGE_OFFER_NOT_FOUND');
  return row;
}
async function candidate(db:D1Database,id:string):Promise<CandidateRow>{
  const row=await db.prepare('SELECT * FROM exchange_v2_candidates WHERE id=?').bind(id).first<CandidateRow>();
  if(!row)throw new ApplicationError('Exchange candidate not found.',404,'EXCHANGE_CANDIDATE_NOT_FOUND');
  return row;
}
function snapJson(member:AssignmentMember){return JSON.stringify(snapshot(member));}
export function insertCandidate(db:D1Database,id:string,domain:ExchangeDomain,intentId:string,offerId:string|null,targetId:string|null,
  legs:{member:AssignmentMember|null;receive:AssignmentMember|null;userId:string;consent:LegRow['consent_source']}[],now:string,
  additionalIntents:string[]=[],matchKey:string|null=null):D1PreparedStatement[]{
  const statements=[db.prepare(`INSERT INTO exchange_v2_candidates
    (id,domain,intent_id,offer_id,target_id,match_key,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'WAITING',?,?)`)
    .bind(id,domain,intentId,offerId,targetId,matchKey,now,now),
    ...[intentId,...additionalIntents].map(i=>db.prepare('INSERT INTO exchange_v2_candidate_intents VALUES (?,?)').bind(id,i)),
    ...legs.map(leg=>db.prepare(`INSERT INTO exchange_v2_candidate_legs
      (candidate_id,user_id,give_assignment_id,receive_assignment_id,give_version,receive_version,
       give_snapshot,receive_snapshot,consent_source,consented_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,leg.userId,leg.member?.id??null,leg.receive?.id??null,leg.member?.version??null,
        leg.receive?.version??null,leg.member?snapJson(leg.member):null,leg.receive?snapJson(leg.receive):null,
        leg.consent,leg.consent?now:null)),
    candidateEvent(db,id,null,'CANDIDATE_CREATED',{domain,legs:legs.map(l=>({userId:l.userId,
      give:l.member?snapshot(l.member):null,receive:l.receive?snapshot(l.receive):null,consentSource:l.consent}))},now),
  ];
  return statements;
}
function inboxTarget(db:D1Database,userId:string,targetId:string,now:string){
  return db.prepare(`INSERT OR IGNORE INTO user_inbox_items (id,user_id,kind,source_type,source_id,created_at)
    SELECT ?,?,'ACTION','EXCHANGE',?,? WHERE EXISTS(SELECT 1 FROM effective_user_permissions
      WHERE user_id=? AND permission_key=(SELECT CASE domain WHEN 'DUTY_OPS' THEN 'duty_ops.swap'
        WHEN 'FLYVASK' THEN 'flyvask.swap' ELSE 'brakkevakt.swap' END FROM exchange_v2_intents
        WHERE id=(SELECT intent_id FROM exchange_v2_targets WHERE id=?)))`)
    .bind(crypto.randomUUID(),userId,targetId,now,userId,targetId);
}

export async function createIntent(db:D1Database,actor:ApplicationUser,domain:ExchangeDomain,sourceId:string,
  targetIds:string[],allowGiveAway:boolean){
  if(!['DUTY_OPS','FLYVASK','BRAKKEVAKT'].includes(domain)||!idPattern.test(sourceId)||
    targetIds.length>10||new Set(targetIds).size!==targetIds.length||targetIds.some(id=>!idPattern.test(id)||id===sourceId)||
    (domain!=='DUTY_OPS'&&allowGiveAway))
    throw new ApplicationError('Choose up to ten distinct valid targets.',400,'INVALID_EXCHANGE_INTENT');
  const now=new Date(),stamp=now.toISOString(),source=await readOwned(db,domain,sourceId,actor.id,now);
  const targets:{member:AssignmentMember;members:AssignmentMember[]}[]=[];
  for(const id of targetIds){
    const members=await readMembers(db,domain,id),member=members[0];
    if(!member||!isExchangeable(domain,member,now)||members.some(m=>m.identity===source.identity)||
      (domain==='BRAKKEVAKT'&&source.periodId===member.periodId))
      throw new ApplicationError('A selected target is not available.',409,'EXCHANGE_TARGET_CHANGED');
    targets.push({member,members});
  }
  const id=crypto.randomUUID();
  const writes:D1PreparedStatement[]=[db.prepare(`INSERT INTO exchange_v2_intents
    (id,domain,owner_user_id,source_assignment_id,source_snapshot,source_version,allow_give_away,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,'OPEN',?,?)`)
    .bind(id,domain,actor.id,sourceId,snapJson(source),source.version,Number(allowGiveAway),stamp,stamp)];
  for(const {member,members} of targets){
    const targetId=crypto.randomUUID();
    writes.push(db.prepare(`INSERT INTO exchange_v2_targets
      (id,intent_id,assignment_id,assignment_snapshot,assignment_version,status,created_at,updated_at)
      VALUES (?,?,?,?,?,'OPEN',?,?)`).bind(targetId,id,member.id,snapJson(member),member.version,stamp,stamp));
    for(const recipient of members)if(recipient.userId!==actor.id)writes.push(inboxTarget(db,recipient.userId,targetId,stamp));
    writes.push(event(db,id,null,actor.id,'TARGET_SELECTED',{targetId,assignment:snapshot(member)},stamp));
  }
  writes.push(event(db,id,null,actor.id,'INTENT_CREATED',
    {domain,ownerUserId:actor.id,source:snapshot(source),targets:targets.map(t=>snapshot(t.member)),allowGiveAway},stamp));
  const predicate=`${currentMemberPredicate(domain)} AND ${legacyReservationPredicate(domain)} AND NOT EXISTS(SELECT 1 FROM exchange_v2_intents
    WHERE domain=? AND owner_user_id=? AND source_assignment_id=? AND status='OPEN')
    ${targets.map(()=>`AND ${currentMemberPredicate(domain)}`).join(' ')}`;
  await guarded(db,domain,actor.id,predicate,
    [...memberPredicateValues(sourceId,actor.id,source.version,domain,now),sourceId,actor.id,domain,actor.id,sourceId,
      ...targets.flatMap(t=>memberPredicateValues(t.member.id,t.member.userId,t.member.version,domain,now))],writes);
  // Matching is a projection on top of an already-created intent. A transient
  // matcher failure must not make the client retry and create a duplicate intent.
  try{return {id,...await generateMatchesForNewIntent(db,actor,domain,id,sourceId)};}
  catch{return {id,candidates:[]};}
}

export async function cancelIntent(db:D1Database,actor:ApplicationUser,intentId:string){
  const row=await intent(db,intentId),now=nowStamp();
  await guarded(db,row.domain,actor.id,`EXISTS(SELECT 1 FROM exchange_v2_intents
    WHERE id=? AND owner_user_id=? AND status='OPEN')`,[intentId,actor.id],[
    db.prepare("UPDATE exchange_v2_intents SET status='CANCELLED',updated_at=? WHERE id=?").bind(now,intentId),
    db.prepare("UPDATE exchange_v2_targets SET status='WITHDRAWN',updated_at=? WHERE intent_id=? AND status='OPEN'").bind(now,intentId),
    db.prepare("UPDATE exchange_v2_offers SET status='DECLINED',updated_at=? WHERE intent_id=? AND status='OPEN'").bind(now,intentId),
    db.prepare(`INSERT INTO exchange_v2_events
      SELECT lower(hex(randomblob(16))),all_links.intent_id,c.id,?,'CANDIDATE_DECLINED',
        'INTENT_CANCELLED',json_object('cancelledIntentId',?),?
      FROM exchange_v2_candidates c
      JOIN exchange_v2_candidate_intents source_link ON source_link.candidate_id=c.id
      JOIN exchange_v2_candidate_intents all_links ON all_links.candidate_id=c.id
      WHERE source_link.intent_id=? AND c.status='WAITING'`)
      .bind(actor.id,intentId,now,intentId),
    db.prepare("UPDATE exchange_v2_candidates SET status='DECLINED',reason='INTENT_CANCELLED',updated_at=? WHERE id IN (SELECT candidate_id FROM exchange_v2_candidate_intents WHERE intent_id=?) AND status='WAITING'").bind(now,intentId),
    db.prepare("DELETE FROM user_inbox_items WHERE source_type='EXCHANGE' AND read_at IS NULL AND source_id IN (SELECT id FROM exchange_v2_targets WHERE intent_id=?)").bind(intentId),
    event(db,intentId,null,actor.id,'INTENT_CANCELLED',{},now),
  ]);
  return {id:intentId};
}

export async function acceptTarget(db:D1Database,actor:ApplicationUser,targetId:string){
  const targetRow=await target(db,targetId),intentRow=await intent(db,targetRow.intent_id),now=new Date(),stamp=now.toISOString();
  if(intentRow.status!=='OPEN'||targetRow.status!=='OPEN')throw conflict();
  const source=await readOwned(db,intentRow.domain,intentRow.source_assignment_id,intentRow.owner_user_id,now);
  const offered=await readOwned(db,intentRow.domain,targetRow.assignment_id,actor.id,now);
  if(source.version!==intentRow.source_version||source.identity===offered.identity||source.id===offered.id||
    !sameAssignmentSnapshot(targetRow.assignment_snapshot,offered)||
    (intentRow.domain==='BRAKKEVAKT'&&source.periodId===offered.periodId))throw conflict();
  const candidateId=crypto.randomUUID();
  const writes=insertCandidate(db,candidateId,intentRow.domain,intentRow.id,null,targetId,[
    {member:source,receive:offered,userId:intentRow.owner_user_id,consent:'TARGET'},
    {member:offered,receive:source,userId:actor.id,consent:'CONFIRMATION'},
  ],stamp);
  writes.push(event(db,intentRow.id,candidateId,actor.id,'TARGET_ACCEPTED',
    {targetId,source:snapshot(source),offered:snapshot(offered)},stamp));
  await guarded(db,intentRow.domain,actor.id,`EXISTS(SELECT 1 FROM exchange_v2_intents i JOIN exchange_v2_targets t ON t.intent_id=i.id
    WHERE i.id=? AND t.id=? AND i.status='OPEN' AND t.status='OPEN')
    AND ${currentMemberPredicate(intentRow.domain)} AND ${currentMemberPredicate(intentRow.domain)}`,
    [intentRow.id,targetId,...memberPredicateValues(source.id,source.userId,source.version,intentRow.domain,now),
      ...memberPredicateValues(offered.id,offered.userId,offered.version,intentRow.domain,now)],writes);
  await commitCandidate(db,actor,candidateId);
  return {id:candidateId,status:'COMPLETED'};
}

export async function createOffer(db:D1Database,actor:ApplicationUser,intentId:string,offeredId:string){
  const row=await intent(db,intentId),now=new Date(),stamp=now.toISOString();
  if(row.status!=='OPEN'||row.owner_user_id===actor.id||!idPattern.test(offeredId))throw conflict();
  const source=await readOwned(db,row.domain,row.source_assignment_id,row.owner_user_id,now);
  const offered=await readOwned(db,row.domain,offeredId,actor.id,now);
  if(source.version!==row.source_version||source.identity===offered.identity||source.id===offered.id||
    (row.domain==='BRAKKEVAKT'&&source.periodId===offered.periodId))throw conflict();
  const selectedTarget=await db.prepare(`SELECT * FROM exchange_v2_targets WHERE intent_id=? AND assignment_id=? AND status='OPEN'`)
    .bind(intentId,offeredId).first<TargetRow>();
  const matchingTarget=selectedTarget&&sameAssignmentSnapshot(selectedTarget.assignment_snapshot,offered)?selectedTarget:null;
  const offerId=crypto.randomUUID(),candidateId=crypto.randomUUID();
  const writes:D1PreparedStatement[]=[db.prepare(`INSERT INTO exchange_v2_offers
    (id,intent_id,offerer_user_id,assignment_id,assignment_snapshot,assignment_version,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'OPEN',?,?)`).bind(offerId,intentId,actor.id,offeredId,snapJson(offered),offered.version,stamp,stamp),
    ...insertCandidate(db,candidateId,row.domain,intentId,offerId,matchingTarget?.id??null,[
      {member:source,receive:offered,userId:row.owner_user_id,consent:matchingTarget?'TARGET':null},
      {member:offered,receive:source,userId:actor.id,consent:'OFFER'},
    ],stamp),
    event(db,intentId,candidateId,actor.id,'OFFER_CREATED',{offerId,offered:snapshot(offered)},stamp)];
  if(!matchingTarget)writes.push(db.prepare(`INSERT OR IGNORE INTO user_inbox_items
    (id,user_id,kind,source_type,source_id,created_at) VALUES (?,?,'ACTION','EXCHANGE',?,?)`)
    .bind(crypto.randomUUID(),row.owner_user_id,candidateId,stamp));
  await guarded(db,row.domain,actor.id,`EXISTS(SELECT 1 FROM exchange_v2_intents WHERE id=? AND status='OPEN')
    AND (SELECT COUNT(*) FROM exchange_v2_offers WHERE intent_id=?)<50
    AND NOT EXISTS(SELECT 1 FROM exchange_v2_offers WHERE intent_id=? AND offerer_user_id=? AND assignment_id=? AND status='OPEN')
    AND ${currentMemberPredicate(row.domain)} AND ${currentMemberPredicate(row.domain)}`,
    [intentId,intentId,intentId,actor.id,offeredId,
      ...memberPredicateValues(source.id,source.userId,source.version,row.domain,now),
      ...memberPredicateValues(offered.id,offered.userId,offered.version,row.domain,now)],writes);
  if(matchingTarget){await commitCandidate(db,actor,candidateId);return {id:offerId,candidateId,status:'COMPLETED'};}
  return {id:offerId,candidateId,status:'OPEN'};
}

export async function withdrawOffer(db:D1Database,actor:ApplicationUser,offerId:string){
  const row=await offer(db,offerId),intentRow=await intent(db,row.intent_id),now=nowStamp();
  await guarded(db,intentRow.domain,actor.id,`EXISTS(SELECT 1 FROM exchange_v2_offers o JOIN exchange_v2_intents i ON i.id=o.intent_id
    WHERE o.id=? AND o.offerer_user_id=? AND o.status='OPEN' AND i.status='OPEN')`,[offerId,actor.id],[
    db.prepare("UPDATE exchange_v2_offers SET status='WITHDRAWN',updated_at=? WHERE id=?").bind(now,offerId),
    db.prepare("UPDATE exchange_v2_candidates SET status='DECLINED',reason='OFFER_WITHDRAWN',updated_at=? WHERE offer_id=? AND status='WAITING'").bind(now,offerId),
    db.prepare("DELETE FROM user_inbox_items WHERE source_type='EXCHANGE' AND read_at IS NULL AND source_id IN (SELECT id FROM exchange_v2_candidates WHERE offer_id=?)").bind(offerId),
    event(db,intentRow.id,null,actor.id,'OFFER_WITHDRAWN',{offerId},now),
  ]);
  return {id:offerId};
}

export async function claimGiveAway(db:D1Database,actor:ApplicationUser,intentId:string){
  const row=await intent(db,intentId),now=new Date(),stamp=now.toISOString();
  if(row.domain!=='DUTY_OPS'||row.status!=='OPEN'||!row.allow_give_away||row.owner_user_id===actor.id)throw conflict();
  const source=await readOwned(db,row.domain,row.source_assignment_id,row.owner_user_id,now);
  if(source.version!==row.source_version)throw conflict();
  const members=await readMembers(db,row.domain,source.id);
  const claimantIdentity=await db.prepare(`SELECT COALESCE(flightlogger_user_id,'portal:'||id) identity FROM users WHERE id=?`)
    .bind(actor.id).first<string>('identity');
  if(!claimantIdentity||members.some(m=>m.identity===claimantIdentity))throw conflict();
  const candidateId=crypto.randomUUID();
  const writes=insertCandidate(db,candidateId,row.domain,intentId,null,null,[
    {member:source,receive:null,userId:row.owner_user_id,consent:'GIVE_AWAY'},
    {member:null,receive:source,userId:actor.id,consent:'CLAIM'},
  ],stamp);
  writes.push(event(db,intentId,candidateId,actor.id,'GIVE_AWAY_CLAIMED',{source:snapshot(source)},stamp));
  await guarded(db,row.domain,actor.id,`EXISTS(SELECT 1 FROM exchange_v2_intents
    WHERE id=? AND status='OPEN' AND allow_give_away=1) AND ${currentMemberPredicate(row.domain)}
    AND NOT EXISTS(SELECT 1 FROM duty_ops_effective_assignments a JOIN users u ON u.id=a.user_id
      WHERE a.shift_id=? AND COALESCE(u.flightlogger_user_id,'portal:'||u.id)=?)`,
    [intentId,...memberPredicateValues(source.id,source.userId,source.version,row.domain,now),source.id,claimantIdentity],writes);
  await commitCandidate(db,actor,candidateId);
  return {id:candidateId,status:'COMPLETED'};
}

function legPublic(row:LegRow):ExchangeLeg{return {userId:row.user_id,giveAssignmentId:row.give_assignment_id,
  receiveAssignmentId:row.receive_assignment_id,giveVersion:row.give_version,receiveVersion:row.receive_version,
  consentSource:row.consent_source,consentedAt:row.consented_at};}
export async function commitCandidate(db:D1Database,actor:ApplicationUser,candidateId:string){
  const row=await candidate(db,candidateId);
  if(row.status!=='WAITING')throw conflict();
  const legs=(await db.prepare('SELECT * FROM exchange_v2_candidate_legs WHERE candidate_id=? ORDER BY user_id')
    .bind(candidateId).all<LegRow>()).results;
  if(legs.length<2||legs.some(leg=>!leg.consented_at)||new Set(legs.map(l=>l.user_id)).size!==legs.length)throw conflict('EXCHANGE_CONSENT_REQUIRED');
  const giving=legs.filter(l=>l.give_assignment_id),receiving=legs.filter(l=>l.receive_assignment_id);
  if(giving.length!==receiving.length||new Set(giving.map(l=>l.give_assignment_id)).size!==giving.length||
    new Set(receiving.map(l=>l.receive_assignment_id)).size!==receiving.length||
    giving.some(l=>!receiving.some(r=>r.receive_assignment_id===l.give_assignment_id)))throw conflict('EXCHANGE_INVALID_LEGS');
  const now=new Date(),stamp=now.toISOString(),current=new Map<string,AssignmentMember>();
  for(const leg of giving){
    const member=await readOwned(db,row.domain,leg.give_assignment_id!,leg.user_id,now);
    if(member.version!==leg.give_version)throw conflict('EXCHANGE_ASSIGNMENT_CHANGED');
    current.set(`${leg.give_assignment_id}:${leg.user_id}`,member);
  }
  if(row.domain==='BRAKKEVAKT'&&legs.some(leg=>leg.give_assignment_id&&leg.receive_assignment_id&&
    current.get(`${leg.give_assignment_id}:${leg.user_id}`)?.periodId===
    giving.map(g=>current.get(`${g.give_assignment_id}:${g.user_id}`)).find(m=>m?.id===leg.receive_assignment_id)?.periodId))
    throw conflict('EXCHANGE_INVALID_TEAM');
  const identities=new Map<string,string>();
  const people=await db.prepare(`SELECT id,COALESCE(flightlogger_user_id,'portal:'||id) identity FROM users
    WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(legs.map(l=>l.user_id)))
    .all<{id:string;identity:string}>();
  for(const person of people.results)identities.set(person.id,person.identity);
  if(identities.size!==legs.length||new Set(identities.values()).size!==legs.length)throw conflict('EXCHANGE_DUPLICATE_PERSON');
  const guardParts=["EXISTS(SELECT 1 FROM exchange_v2_candidates WHERE id=? AND status='WAITING')",
    "NOT EXISTS(SELECT 1 FROM exchange_v2_candidate_legs WHERE candidate_id=? AND consented_at IS NULL)",
    `NOT EXISTS(SELECT 1 FROM exchange_v2_candidate_intents ci JOIN exchange_v2_intents i ON i.id=ci.intent_id
      WHERE ci.candidate_id=? AND i.status<>'OPEN')`];
  const values:unknown[]=[candidateId,candidateId,candidateId];
  for(const leg of legs){
    guardParts.push(`EXISTS(SELECT 1 FROM effective_user_permissions WHERE user_id=? AND permission_key='${permissions[row.domain]}')`);
    values.push(leg.user_id);
  }
  for(const leg of giving){
    guardParts.push(currentMemberPredicate(row.domain));
    values.push(...memberPredicateValues(leg.give_assignment_id!,leg.user_id,leg.give_version!,row.domain,now));
    guardParts.push(legacyReservationPredicate(row.domain));
    values.push(leg.give_assignment_id,leg.user_id);
  }
  for(const leg of receiving){
    const identity=identities.get(leg.user_id)!;
    if(row.domain==='BRAKKEVAKT'){
      guardParts.push(`NOT EXISTS(SELECT 1 FROM brakkevakt_assignments a JOIN users u ON u.id=a.user_id
        WHERE a.period_id=(SELECT period_id FROM brakkevakt_assignments WHERE id=?) AND a.id<>?
        AND COALESCE(u.flightlogger_user_id,'portal:'||u.id)=?)`);
      values.push(leg.receive_assignment_id,leg.receive_assignment_id,identity);
    }else{
      const view=row.domain==='DUTY_OPS'?'duty_ops_candidate_assignments':'flyvask_candidate_assignments';
      guardParts.push(`NOT EXISTS(SELECT 1 FROM ${view} a JOIN users u ON u.id=a.user_id
        WHERE a.shift_id=? AND COALESCE(u.flightlogger_user_id,'portal:'||u.id)=?)`);
      values.push(leg.receive_assignment_id,identity);
    }
  }
  const deltas=legs.map(leg=>({userId:leg.user_id,amount:Number(!!leg.receive_assignment_id)-Number(!!leg.give_assignment_id)}));
  if(deltas.reduce((sum,d)=>sum+d.amount,0)!==0||deltas.some(d=>Math.abs(d.amount)>1))throw conflict('EXCHANGE_CREDIT_INVALID');
  if(row.domain==='DUTY_OPS')for(const delta of deltas.filter(d=>d.amount<0)){
    guardParts.push('COALESCE((SELECT balance FROM duty_ops_credit_balances WHERE user_id=?),0)+?>=-2');
    values.push(delta.userId,delta.amount);
  }
  const writes:D1PreparedStatement[]=[];
  if(row.domain==='BRAKKEVAKT'){
    const periods=new Set<string>();
    for(const leg of receiving){
      const given=giving.find(l=>l.give_assignment_id===leg.receive_assignment_id)!;
      periods.add(current.get(`${given.give_assignment_id}:${given.user_id}`)!.periodId!);
      writes.push(db.prepare(`UPDATE brakkevakt_assignments SET user_id=?,updated_at=?,updated_by_user_id=? WHERE id=?`)
        .bind(leg.user_id,stamp,actor.id,leg.receive_assignment_id));
    }
    for(const periodId of periods)writes.push(db.prepare(`UPDATE brakkevakt_periods SET revision=revision+1,
      updated_at=?,updated_by_user_id=? WHERE id=?`).bind(stamp,actor.id,periodId));
  }else{
    for(const leg of legs){
      if(leg.give_assignment_id)writes.push(db.prepare(`INSERT INTO exchange_v2_assignment_effects
        (candidate_id,domain,assignment_id,user_id,assigned,completed_at) VALUES (?,?,?,?,0,?)`)
        .bind(candidateId,row.domain,leg.give_assignment_id,leg.user_id,stamp));
      if(leg.receive_assignment_id)writes.push(db.prepare(`INSERT INTO exchange_v2_assignment_effects
        (candidate_id,domain,assignment_id,user_id,assigned,completed_at) VALUES (?,?,?,?,1,?)`)
        .bind(candidateId,row.domain,leg.receive_assignment_id,leg.user_id,stamp));
    }
  }
  if(row.domain==='DUTY_OPS')for(const delta of deltas.filter(d=>d.amount!==0))
    writes.push(db.prepare('INSERT INTO exchange_v2_credit_entries VALUES (?,?,?,?)')
      .bind(candidateId,delta.userId,delta.amount,stamp));
  const changed=JSON.stringify(giving.map(l=>({assignmentId:l.give_assignment_id,userId:l.user_id})));
  writes.push(
    db.prepare(`INSERT INTO exchange_v2_events
      SELECT lower(hex(randomblob(16))),ci.intent_id,c.id,?,'CANDIDATE_SUPERSEDED',
        'CONFLICTING_EXCHANGE_COMPLETED',json_object('winnerCandidateId',?,'candidateId',c.id),?
      FROM exchange_v2_candidates c JOIN exchange_v2_candidate_intents ci ON ci.candidate_id=c.id
      WHERE c.status='WAITING' AND c.id<>? AND EXISTS(
        SELECT 1 FROM exchange_v2_candidate_legs leg JOIN json_each(?) changed
        ON leg.give_assignment_id=json_extract(changed.value,'$.assignmentId')
        AND leg.user_id=json_extract(changed.value,'$.userId') WHERE leg.candidate_id=c.id)`)
      .bind(actor.id,candidateId,stamp,candidateId,changed),
    db.prepare(`INSERT INTO exchange_v2_events
      SELECT lower(hex(randomblob(16))),i.id,NULL,?,'INTENT_SUPERSEDED',
        'CONFLICTING_EXCHANGE_COMPLETED',json_object('winnerCandidateId',?,'sourceAssignmentId',i.source_assignment_id),?
      FROM exchange_v2_intents i WHERE i.domain=? AND i.status='OPEN' AND EXISTS(
        SELECT 1 FROM json_each(?) changed WHERE i.source_assignment_id=json_extract(changed.value,'$.assignmentId')
        AND i.owner_user_id=json_extract(changed.value,'$.userId'))`)
      .bind(actor.id,candidateId,stamp,row.domain,changed),
    db.prepare(`INSERT INTO exchange_v2_events
      SELECT lower(hex(randomblob(16))),t.intent_id,?,?,'TARGET_SUPERSEDED',
        'CONFLICTING_EXCHANGE_COMPLETED',json_object('winnerCandidateId',?,'targetId',t.id),?
      FROM exchange_v2_targets t WHERE t.status='OPEN' AND (t.id<>? OR ? IS NULL)
      AND t.intent_id IN (SELECT intent_id FROM exchange_v2_candidate_intents WHERE candidate_id=?)`)
      .bind(candidateId,actor.id,candidateId,stamp,row.target_id,row.target_id,candidateId),
    db.prepare(`INSERT INTO exchange_v2_events
      SELECT lower(hex(randomblob(16))),o.intent_id,?,?,'OFFER_SUPERSEDED',
        'CONFLICTING_EXCHANGE_COMPLETED',json_object('winnerCandidateId',?,'offerId',o.id),?
      FROM exchange_v2_offers o WHERE o.status='OPEN' AND (o.id<>? OR ? IS NULL)
      AND o.intent_id IN (SELECT intent_id FROM exchange_v2_candidate_intents WHERE candidate_id=?)`)
      .bind(candidateId,actor.id,candidateId,stamp,row.offer_id,row.offer_id,candidateId),
    db.prepare("UPDATE exchange_v2_candidates SET status='COMPLETED',completed_at=?,updated_at=? WHERE id=?").bind(stamp,stamp,candidateId),
    db.prepare(`UPDATE exchange_v2_intents SET status='COMPLETED',completed_candidate_id=?,updated_at=?
      WHERE id IN (SELECT intent_id FROM exchange_v2_candidate_intents WHERE candidate_id=?)`).bind(candidateId,stamp,candidateId),
    db.prepare(`UPDATE exchange_v2_targets SET status=CASE WHEN id=? THEN 'COMPLETED' ELSE 'SUPERSEDED' END,
      reason=CASE WHEN id=? THEN NULL ELSE 'CONFLICTING_EXCHANGE_COMPLETED' END,updated_at=?
      WHERE intent_id IN (SELECT intent_id FROM exchange_v2_candidate_intents WHERE candidate_id=?) AND status='OPEN'`)
      .bind(row.target_id,row.target_id,stamp,candidateId),
    db.prepare(`UPDATE exchange_v2_offers SET status=CASE WHEN id=? THEN 'COMPLETED' ELSE 'SUPERSEDED' END,
      reason=CASE WHEN id=? THEN NULL ELSE 'CONFLICTING_EXCHANGE_COMPLETED' END,updated_at=?
      WHERE intent_id IN (SELECT intent_id FROM exchange_v2_candidate_intents WHERE candidate_id=?) AND status='OPEN'`)
      .bind(row.offer_id,row.offer_id,stamp,candidateId),
    db.prepare(`UPDATE exchange_v2_intents SET status='SUPERSEDED',reason='CONFLICTING_EXCHANGE_COMPLETED',updated_at=?
      WHERE domain=? AND status='OPEN' AND EXISTS(SELECT 1 FROM json_each(?) changed
        WHERE source_assignment_id=json_extract(changed.value,'$.assignmentId')
        AND owner_user_id=json_extract(changed.value,'$.userId'))`).bind(stamp,row.domain,changed),
    db.prepare(`UPDATE exchange_v2_candidates SET status='SUPERSEDED',reason='CONFLICTING_EXCHANGE_COMPLETED',
      caused_by_candidate_id=?,updated_at=? WHERE status='WAITING' AND id<>? AND EXISTS(
      SELECT 1 FROM exchange_v2_candidate_legs leg JOIN json_each(?) changed
      ON leg.give_assignment_id=json_extract(changed.value,'$.assignmentId') AND leg.user_id=json_extract(changed.value,'$.userId')
      WHERE leg.candidate_id=exchange_v2_candidates.id)`).bind(candidateId,stamp,candidateId,changed),
    db.prepare(`UPDATE exchange_v2_targets SET status='SUPERSEDED',reason='CONFLICTING_EXCHANGE_COMPLETED',updated_at=?
      WHERE status='OPEN' AND intent_id IN (SELECT id FROM exchange_v2_intents WHERE status='SUPERSEDED')`).bind(stamp),
    db.prepare(`UPDATE exchange_v2_offers SET status='SUPERSEDED',reason='CONFLICTING_EXCHANGE_COMPLETED',updated_at=?
      WHERE status='OPEN' AND intent_id IN (SELECT id FROM exchange_v2_intents WHERE status='SUPERSEDED')`).bind(stamp),
    db.prepare(`DELETE FROM user_inbox_items WHERE source_type='EXCHANGE' AND read_at IS NULL AND source_id IN
      (SELECT id FROM exchange_v2_targets WHERE status IN ('SUPERSEDED','COMPLETED')
        AND intent_id IN (SELECT intent_id FROM exchange_v2_candidate_intents WHERE candidate_id=?))
      AND user_id NOT IN (SELECT user_id FROM exchange_v2_candidate_legs WHERE candidate_id=?)`).bind(candidateId,candidateId),
    db.prepare(`DELETE FROM user_inbox_items WHERE source_type='EXCHANGE' AND read_at IS NULL AND source_id IN
      (SELECT id FROM exchange_v2_candidates WHERE status='SUPERSEDED' AND caused_by_candidate_id=?)
      AND user_id NOT IN (SELECT user_id FROM exchange_v2_candidate_legs WHERE candidate_id=?)`).bind(candidateId,candidateId),
    db.prepare(`INSERT INTO exchange_v2_events
      SELECT lower(hex(randomblob(16))),ci.intent_id,?,?,'CANDIDATE_COMMITTED',NULL,?,?
      FROM exchange_v2_candidate_intents ci WHERE ci.candidate_id=?`)
      .bind(candidateId,actor.id,JSON.stringify({domain:row.domain,legs:legs.map(legPublic),creditDeltas:deltas,
        changedAssignments:giving.map(l=>l.give_assignment_id)}),stamp,candidateId),
  );
  for(const leg of legs)if(leg.user_id!==actor.id)writes.push(db.prepare(`INSERT OR IGNORE INTO user_inbox_items
    (id,user_id,kind,source_type,source_id,created_at) VALUES (?,?,'INFO','EXCHANGE',?,?)`)
    .bind(crypto.randomUUID(),leg.user_id,candidateId,stamp));
  await guarded(db,row.domain,actor.id,guardParts.join(' AND '),values,writes);
  await reconcileExchangeV2IfInstalled(db,row.domain,giving.map(leg=>leg.give_assignment_id!));
  return {id:candidateId,status:'COMPLETED'};
}

export async function confirmCandidate(db:D1Database,actor:ApplicationUser,candidateId:string){
  const row=await candidate(db,candidateId),now=nowStamp();
  if(row.status!=='WAITING')throw conflict();
  if(row.domain!=='BRAKKEVAKT'){
    const giving=(await db.prepare(`SELECT give_assignment_id id FROM exchange_v2_candidate_legs
      WHERE candidate_id=? AND give_assignment_id IS NOT NULL`).bind(candidateId).all<{id:string}>()).results.map(item=>item.id);
    if(await hasAssignmentConflict(db,row.domain,giving))throw assignmentConflict();
  }
  await guarded(db,row.domain,actor.id,`EXISTS(SELECT 1 FROM exchange_v2_candidate_legs l
    JOIN exchange_v2_candidates c ON c.id=l.candidate_id WHERE l.candidate_id=? AND l.user_id=?
    AND l.consented_at IS NULL AND c.status='WAITING')
    ${row.domain==='BRAKKEVAKT'?'':`AND NOT EXISTS (SELECT 1 FROM exchange_v2_candidate_legs l
      JOIN assignment_reconciliation r ON r.domain='${row.domain}' AND r.shift_id=l.give_assignment_id
      WHERE l.candidate_id=? AND r.status='CONFLICT')`}`,
    row.domain==='BRAKKEVAKT'?[candidateId,actor.id]:[candidateId,actor.id,candidateId],[
    db.prepare(`UPDATE exchange_v2_candidate_legs SET consent_source='CONFIRMATION',consented_at=?
      WHERE candidate_id=? AND user_id=? AND consented_at IS NULL`).bind(now,candidateId,actor.id),
    db.prepare(`DELETE FROM user_inbox_items WHERE user_id=? AND source_type='EXCHANGE'
      AND source_id=? AND read_at IS NULL`).bind(actor.id,candidateId),
    candidateEvent(db,candidateId,actor.id,'CONSENT_CONFIRMED',{candidateId},now),
  ]);
  const pending=await db.prepare('SELECT count(*) n FROM exchange_v2_candidate_legs WHERE candidate_id=? AND consented_at IS NULL')
    .bind(candidateId).first<{n:number}>();
  return pending?.n?{id:candidateId,status:'WAITING'}:commitCandidate(db,actor,candidateId);
}

export async function declineCandidate(db:D1Database,actor:ApplicationUser,candidateId:string){
  const row=await candidate(db,candidateId),now=nowStamp();
  await guarded(db,row.domain,actor.id,`EXISTS(SELECT 1 FROM exchange_v2_candidate_legs l
    JOIN exchange_v2_candidates c ON c.id=l.candidate_id WHERE l.candidate_id=? AND l.user_id=?
    AND c.status='WAITING')`,[candidateId,actor.id],[
    db.prepare("UPDATE exchange_v2_candidates SET status='DECLINED',reason='PARTICIPANT_DECLINED',updated_at=? WHERE id=?")
      .bind(now,candidateId),
    candidateEvent(db,candidateId,actor.id,'CANDIDATE_DECLINED',{candidateId},now),
  ]);
  return {id:candidateId,status:'DECLINED'};
}

async function generateMatchesForNewIntent(db:D1Database,actor:ApplicationUser,domain:ExchangeDomain,
  intentId:string,sourceId:string){
  const roots=(await db.prepare(`SELECT i.id FROM exchange_v2_intents i
    WHERE i.domain=? AND i.status='OPEN' AND (i.id=? OR EXISTS(
      SELECT 1 FROM exchange_v2_targets t WHERE t.intent_id=i.id AND t.status='OPEN' AND t.assignment_id=?)
      OR EXISTS(SELECT 1 FROM exchange_v2_targets t
        JOIN exchange_v2_intents middle ON middle.domain=i.domain AND middle.status='OPEN'
          AND middle.source_assignment_id=t.assignment_id
        JOIN exchange_v2_targets next ON next.intent_id=middle.id AND next.status='OPEN'
        WHERE t.intent_id=i.id AND t.status='OPEN' AND next.assignment_id=?))
    ORDER BY CASE WHEN i.id=? THEN 0 ELSE 1 END,i.created_at DESC,i.id DESC LIMIT 200`)
    .bind(domain,intentId,sourceId,sourceId,intentId)
    .all<{id:string}>()).results;
  const candidates:{id:string;status:string}[]=[];
  for(const root of roots){
    const result=await generateMatchesFromRoot(db,actor,await intent(db,root.id));
    candidates.push(...result.candidates);
    if(result.candidates.some(item=>item.status==='COMPLETED'))break;
  }
  return {candidates};
}
export async function generateMatches(db:D1Database,actor:ApplicationUser,intentId:string){
  const rootRow=await intent(db,intentId);
  if(rootRow.owner_user_id!==actor.id||rootRow.status!=='OPEN')throw conflict();
  if(rootRow.domain!=='BRAKKEVAKT'&&await hasAssignmentConflict(db,rootRow.domain,[rootRow.source_assignment_id]))
    throw assignmentConflict();
  return generateMatchesFromRoot(db,actor,rootRow);
}
async function generateMatchesFromRoot(db:D1Database,actor:ApplicationUser,rootRow:IntentRow){
  if(rootRow.status!=='OPEN')return {candidates:[]};
  const intentId=rootRow.id;
  const rows=(await db.prepare(`SELECT id,owner_user_id,source_assignment_id,source_version FROM exchange_v2_intents
    WHERE domain=? AND status='OPEN'
    ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 200`).bind(rootRow.domain,rootRow.id)
    .all<Pick<IntentRow,'id'|'owner_user_id'|'source_assignment_id'|'source_version'>>()).results;
  const targets=(await db.prepare(`SELECT intent_id,assignment_id,assignment_snapshot FROM exchange_v2_targets
    WHERE status='OPEN' AND intent_id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(rows.map(row=>row.id))).all<{intent_id:string;assignment_id:string;assignment_snapshot:string}>()).results;
  const all:MatchIntent[]=rows.map(row=>({id:row.id,ownerUserId:row.owner_user_id,
    sourceAssignmentId:row.source_assignment_id,targets:targets.filter(t=>t.intent_id===row.id).map(t=>t.assignment_id)}));
  const root=all.find(row=>row.id===intentId);
  if(!root)return {candidates:[]};
  const cycles=[...findDirectMatches(root,all),...findThreeWayCycles(root,all)];
  const created:{id:string;status:string}[]=[];
  for(const cycle of cycles.slice(0,10)){
    const key=matchKey(rootRow.domain,cycle.intentIds);
    if(await db.prepare('SELECT 1 FROM exchange_v2_candidates WHERE match_key=?').bind(key).first())continue;
    const chain=cycle.intentIds.map(id=>all.find(row=>row.id===id)!);
    const now=new Date(),stamp=now.toISOString(),members:AssignmentMember[]=[];
    try{
      for(const item of chain)members.push(await readOwned(db,rootRow.domain,item.sourceAssignmentId,item.ownerUserId,now));
    }catch{continue;}
    if(new Set(members.map(m=>m.identity)).size!==members.length||new Set(members.map(m=>m.id)).size!==members.length||
      members.some((member,index)=>member.version!==rows.find(r=>r.id===chain[index].id)?.source_version)||
      cycle.consented.some((consented,index)=>consented&&
        !targets.some(t=>t.intent_id===chain[index].id&&t.assignment_id===members[(index+1)%members.length].id&&
          sameAssignmentSnapshot(t.assignment_snapshot,members[(index+1)%members.length]))))continue;
    const candidateId=crypto.randomUUID();
    const legs=members.map((member,index)=>({member,receive:members[(index+1)%members.length],
      userId:member.userId,consent:cycle.consented[index]?'TARGET' as const:null}));
    const predicate=[`NOT EXISTS(SELECT 1 FROM exchange_v2_candidates WHERE match_key=?)`,
      ...chain.map(()=>`EXISTS(SELECT 1 FROM exchange_v2_intents WHERE id=? AND status='OPEN')`),
      ...members.map(()=>currentMemberPredicate(rootRow.domain)),
      ...members.map(()=>legacyReservationPredicate(rootRow.domain)),
      ...members.map(()=>`EXISTS(SELECT 1 FROM effective_user_permissions
        WHERE user_id=? AND permission_key='${permissions[rootRow.domain]}')`)].join(' AND ');
    const values:unknown[]=[key,...chain.map(item=>item.id),
      ...members.flatMap(member=>memberPredicateValues(member.id,member.userId,member.version,rootRow.domain,now)),
      ...members.flatMap(member=>[member.id,member.userId]),...members.map(member=>member.userId)];
    const writes=insertCandidate(db,candidateId,rootRow.domain,intentId,null,null,legs,stamp,
      cycle.intentIds.slice(1),key);
    for(const linkedIntentId of cycle.intentIds){
      writes.push(event(db,linkedIntentId,candidateId,actor.id,'MATCH_SUGGESTED',
        {intentIds:cycle.intentIds,consented:cycle.consented,legs:legs.map(l=>({userId:l.userId,
          give:l.member?snapshot(l.member):null,receive:l.receive?snapshot(l.receive):null}))},stamp));
    }
    for(const leg of legs)if(!leg.consent)writes.push(db.prepare(`INSERT OR IGNORE INTO user_inbox_items
      (id,user_id,kind,source_type,source_id,created_at) VALUES (?,?,'ACTION','EXCHANGE',?,?)`)
      .bind(crypto.randomUUID(),leg.userId,candidateId,stamp));
    try{await guarded(db,rootRow.domain,actor.id,predicate,values,writes);}catch{continue;}
    if(cycle.consented.every(Boolean)){
      try{await commitCandidate(db,actor,candidateId);created.push({id:candidateId,status:'COMPLETED'});break;}
      catch{created.push({id:candidateId,status:'WAITING'});}
    }else created.push({id:candidateId,status:'WAITING'});
  }
  return {candidates:created};
}
