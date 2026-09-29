import type { ApplicationUser } from '../users';
import { hasPermission } from '../authorization';
import { PERMISSIONS } from '../../shared/authorization';
import type { AssignmentActionState, ExchangeAction, ExchangeDomain, ExchangeRelationship } from '../../shared/exchange-v2';
import { hasLegacyReservation, isExchangeable, readExchangeableOwnedIds, readMembers, snapshot, type AssignmentMember } from './assignments';
import { reconcileExchangeV2 } from './reconciliation';

const swapPermission={DUTY_OPS:PERMISSIONS.dutyOpsSwap,FLYVASK:PERMISSIONS.flyvaskSwap,
  BRAKKEVAKT:PERMISSIONS.brakkevaktSwap} as const;
type Intent={id:string;owner_user_id:string;source_assignment_id:string;source_snapshot:string;status:string;
  allow_give_away:number;created_at:string;reason:string|null;first_name:string|null;last_name:string|null};
type Target={id:string;intent_id:string;assignment_id:string;assignment_snapshot:string;status:string;reason:string|null};
type Offer={id:string;intent_id:string;offerer_user_id:string;assignment_id:string;assignment_snapshot:string;
  status:string;reason:string|null;first_name:string|null;last_name:string|null};
type Candidate={id:string;intent_id:string;status:string;reason:string|null;created_at:string;completed_at:string|null;
  target_id:string|null;offer_id:string|null};
type Leg={candidate_id:string;user_id:string;give_assignment_id:string|null;receive_assignment_id:string|null;
  consent_source:string|null;consented_at:string|null;give_snapshot:string|null;receive_snapshot:string|null;
  first_name:string|null;last_name:string|null};
const person=(id:string,first:string|null,last:string|null)=>({id,firstName:first,lastName:last});
function distinct<T>(values:T[]):T[]{return [...new Set(values)];}

export async function listExchangeV2(db:D1Database,actor:ApplicationUser,domain:ExchangeDomain,assignmentIds:string[]=[]){
  await reconcileExchangeV2(db,domain);
  const canSwap=await hasPermission(db,actor,swapPermission[domain]);
  const [intentsResult,targetsResult,offersResult,candidatesResult,legsResult]=await db.batch([
    db.prepare(`SELECT i.*,u.flightlogger_first_name first_name,u.flightlogger_last_name last_name
      FROM exchange_v2_intents i JOIN users u ON u.id=i.owner_user_id
      WHERE i.domain=? AND (i.status='OPEN' OR i.owner_user_id=?)
      ORDER BY i.created_at DESC,i.id DESC`).bind(domain,actor.id),
    db.prepare(`SELECT t.* FROM exchange_v2_targets t JOIN exchange_v2_intents i ON i.id=t.intent_id
      WHERE i.domain=? AND (i.status='OPEN' OR i.owner_user_id=?) ORDER BY t.created_at,t.id`)
      .bind(domain,actor.id),
    db.prepare(`SELECT o.*,u.flightlogger_first_name first_name,u.flightlogger_last_name last_name
      FROM exchange_v2_offers o JOIN exchange_v2_intents i ON i.id=o.intent_id JOIN users u ON u.id=o.offerer_user_id
      WHERE i.domain=? AND (i.owner_user_id=? OR o.offerer_user_id=?) ORDER BY o.created_at,o.id`)
      .bind(domain,actor.id,actor.id),
    db.prepare(`SELECT DISTINCT c.* FROM exchange_v2_candidates c LEFT JOIN exchange_v2_candidate_legs l ON l.candidate_id=c.id
      JOIN exchange_v2_intents i ON i.id=c.intent_id
      WHERE c.domain=? AND (i.owner_user_id=? OR l.user_id=?) ORDER BY c.created_at DESC,c.id DESC`)
      .bind(domain,actor.id,actor.id),
    db.prepare(`SELECT l.*,u.flightlogger_first_name first_name,u.flightlogger_last_name last_name
      FROM exchange_v2_candidate_legs l JOIN exchange_v2_candidates c ON c.id=l.candidate_id
      JOIN exchange_v2_intents i ON i.id=c.intent_id JOIN users u ON u.id=l.user_id
      WHERE c.domain=? AND (i.owner_user_id=? OR EXISTS(SELECT 1 FROM exchange_v2_candidate_legs own
        WHERE own.candidate_id=c.id AND own.user_id=?)) ORDER BY l.candidate_id,l.user_id`)
      .bind(domain,actor.id,actor.id),
  ]);
  const intents=intentsResult.results as Intent[],targets=targetsResult.results as Target[],
    offers=offersResult.results as Offer[],candidates=candidatesResult.results as Candidate[],legs=legsResult.results as Leg[];
  const publicIntents=intents.map(i=>({id:i.id,status:i.status,reason:i.reason,
    owner:person(i.owner_user_id,i.first_name,i.last_name),source:JSON.parse(i.source_snapshot),
    allowGiveAway:!!i.allow_give_away,createdAt:i.created_at,
    targets:targets.filter(t=>t.intent_id===i.id).map(t=>({id:t.id,status:t.status,reason:t.reason,
      assignment:JSON.parse(t.assignment_snapshot)})),
    offers:offers.filter(o=>o.intent_id===i.id).map(o=>({id:o.id,status:o.status,reason:o.reason,
      offerer:person(o.offerer_user_id,o.first_name,o.last_name),assignment:JSON.parse(o.assignment_snapshot)}))}));
  const publicCandidates=candidates.map(c=>({id:c.id,intentId:c.intent_id,status:c.status,reason:c.reason,
    targetId:c.target_id,offerId:c.offer_id,createdAt:c.created_at,completedAt:c.completed_at,
    legs:legs.filter(l=>l.candidate_id===c.id).map(l=>({user:person(l.user_id,l.first_name,l.last_name),
      give:l.give_snapshot?JSON.parse(l.give_snapshot):null,receive:l.receive_snapshot?JSON.parse(l.receive_snapshot):null,
      consentSource:l.consent_source,consentedAt:l.consented_at}))}));
  const ownedIds=canSwap?await readExchangeableOwnedIds(db,domain,actor.id):[];
  const stateIds=distinct([...assignmentIds,...ownedIds,...intents.filter(i=>i.owner_user_id===actor.id).map(i=>i.source_assignment_id),
    ...offers.filter(o=>o.offerer_user_id===actor.id).map(o=>o.assignment_id),
    ...targets.map(t=>t.assignment_id)]);
  const assignmentStates:AssignmentActionState[]=[];
  const actorIdentity=await db.prepare("SELECT COALESCE(flightlogger_user_id,'portal:'||id) identity FROM users WHERE id=?")
    .bind(actor.id).first<string>('identity');
  const ownedSources=new Map<string,AssignmentMember>();
  if(canSwap)for(const id of ownedIds){
    const member=(await readMembers(db,domain,id)).find(item=>item.userId===actor.id);
    if(member&&isExchangeable(domain,member)&&!await hasLegacyReservation(db,domain,id,actor.id)&&
      !intents.some(intent=>intent.owner_user_id===actor.id&&intent.source_assignment_id===id&&intent.status==='OPEN'))
      ownedSources.set(id,member);
  }
  const currentSources=new Map<string,AssignmentMember>();
  if(canSwap)for(const item of intents.filter(i=>i.status==='OPEN')){
    const member=(await readMembers(db,domain,item.source_assignment_id)).find(m=>m.userId===item.owner_user_id);
    const saved=JSON.parse(item.source_snapshot) as {version:string};
    if(member&&isExchangeable(domain,member)&&member.version===saved.version)currentSources.set(item.id,member);
  }
  for(const assignmentId of stateIds){
    const members=await readMembers(db,domain,assignmentId),mine=members.find(m=>m.userId===actor.id);
    const eligible=!!members[0]&&isExchangeable(domain,members[0]);
    const legacyLocked=!!mine&&await hasLegacyReservation(db,domain,assignmentId,actor.id);
    const ownIntent=intents.find(i=>i.owner_user_id===actor.id&&i.source_assignment_id===assignmentId&&i.status==='OPEN');
    const incoming=targets.filter(t=>t.assignment_id===assignmentId&&t.status==='OPEN'&&mine&&
      intents.some(i=>i.id===t.intent_id&&i.owner_user_id!==actor.id&&i.status==='OPEN'&&
        currentSources.has(i.id)&&currentSources.get(i.id)!.identity!==mine.identity&&
        (domain!=='BRAKKEVAKT'||currentSources.get(i.id)!.periodId!==mine.periodId))&&
      (()=>{const saved=JSON.parse(t.assignment_snapshot) as {startsAt:string;endsAt:string;status:string};
        return saved.startsAt===mine.startsAt&&saved.endsAt===mine.endsAt&&saved.status===mine.status;})());
    const ownOffer=offers.find(o=>o.assignment_id===assignmentId&&o.offerer_user_id===actor.id&&o.status==='OPEN');
    const sentTargets=targets.filter(t=>t.assignment_id===assignmentId&&t.status==='OPEN'&&
      intents.some(i=>i.id===t.intent_id&&i.owner_user_id===actor.id&&i.status==='OPEN'));
    const review=candidates.filter(c=>c.status==='WAITING'&&legs.some(l=>l.candidate_id===c.id&&l.user_id===actor.id&&
      !l.consented_at&&(l.give_assignment_id===assignmentId||l.receive_assignment_id===assignmentId)));
    const waiting=candidates.filter(c=>c.status==='WAITING'&&legs.some(l=>l.candidate_id===c.id&&l.user_id===actor.id&&
      !!l.consented_at&&(l.give_assignment_id===assignmentId||l.receive_assignment_id===assignmentId)));
    const relatedCandidateIds=candidates.filter(c=>legs.some(l=>l.candidate_id===c.id&&
      (l.give_assignment_id===assignmentId||l.receive_assignment_id===assignmentId))).map(c=>c.id);
    let relationship:ExchangeRelationship='NONE';
    const actions:ExchangeAction[]=[];
    const requestableSourceAssignments=canSwap&&eligible&&!mine&&!sentTargets.length
      ? [...ownedSources.values()].filter(source=>source.id!==assignmentId&&
        !members.some(member=>member.identity===source.identity)&&
        (domain!=='BRAKKEVAKT'||source.periodId!==members[0].periodId)).map(snapshot):[];
    const requestableSourceAssignmentIds=requestableSourceAssignments.map(source=>source.id);
    const offerableIntentIds=canSwap&&eligible&&mine&&!legacyLocked
      ? intents.filter(i=>i.status==='OPEN'&&i.owner_user_id!==actor.id&&i.source_assignment_id!==assignmentId&&
        currentSources.has(i.id)&&currentSources.get(i.id)!.identity!==mine.identity&&
        (domain!=='BRAKKEVAKT'||currentSources.get(i.id)!.periodId!==mine.periodId)&&
        !offers.some(o=>o.intent_id===i.id&&o.offerer_user_id===actor.id&&o.assignment_id===assignmentId&&o.status==='OPEN'))
        .map(i=>i.id):[];
    if(eligible&&mine){
      relationship=review.length?'CANDIDATE_REVIEW_REQUIRED':waiting.length?'CANDIDATE_WAITING':ownOffer?'OFFER_SENT':ownIntent?'OWN_EXCHANGE_OPEN':
        incoming.length?'INCOMING_REQUEST':'OWN_IDLE';
      if(canSwap){
        if(review.length)actions.push('CONFIRM_CANDIDATE','DECLINE_CANDIDATE');
        if(ownOffer)actions.push('WITHDRAW_OFFER');
        if(ownIntent)actions.push('CANCEL_INTENT');else if(!legacyLocked)actions.push('OPEN_EXCHANGE');
        if(incoming.length&&!legacyLocked)actions.push('ACCEPT_TARGET');
        if(offerableIntentIds.length)actions.push('OFFER_SHIFT');
      }
    }else if(eligible&&sentTargets.length){
      relationship='REQUEST_SENT';
    }else if(eligible&&intents.some(i=>i.source_assignment_id===assignmentId&&i.status==='OPEN'&&i.owner_user_id!==actor.id)){
      const available=intents.find(i=>i.source_assignment_id===assignmentId&&i.status==='OPEN'&&i.owner_user_id!==actor.id)!;
      relationship=domain==='DUTY_OPS'&&available.allow_give_away?'GIVE_AWAY_AVAILABLE':'SWAP_AVAILABLE';
      if(canSwap&&relationship==='GIVE_AWAY_AVAILABLE'&&currentSources.has(available.id)&&
        !members.some(m=>m.identity===actorIdentity)){
        const balance=await db.prepare('SELECT balance FROM duty_ops_credit_balances WHERE user_id=?')
          .bind(available.owner_user_id).first<{balance:number}>();
        if((balance?.balance??0)>-2)actions.push('TAKE_GIVE_AWAY');
      }
    }
    if(requestableSourceAssignmentIds.length&&canSwap)actions.push('REQUEST_SWAP');
    if(canSwap&&eligible&&relatedCandidateIds.length&&relationship==='NONE')actions.push('VIEW_EXCHANGE');
    assignmentStates.push({assignmentId,relationship,availableActions:actions,
      relatedIntentIds:distinct([...intents.filter(i=>i.source_assignment_id===assignmentId).map(i=>i.id),
        ...incoming.map(t=>t.intent_id),...sentTargets.map(t=>t.intent_id)]),relatedCandidateIds,
      requestableSourceAssignmentIds,requestableSourceAssignments,offerableIntentIds});
  }
  return {domain,currentUserId:actor.id,timeZone:'Europe/Oslo',intents:publicIntents,
    candidates:publicCandidates,assignmentStates};
}
