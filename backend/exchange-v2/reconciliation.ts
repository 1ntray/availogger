import type { ExchangeDomain } from '../../shared/exchange-v2';
import { currentMemberPredicate, hasLegacyReservation, isExchangeable, legacyReservationPredicate,
  memberPredicateValues, readMembers } from './assignments';
import { osloDay } from '../brakkevakt/week';
import { hasAssignmentConflict } from '../assignment-reconciliation';

type Intent={id:string;domain:ExchangeDomain;owner_user_id:string;source_assignment_id:string;source_version:string;
  source_snapshot:string;status:string};
type Target={id:string;intent_id:string;assignment_id:string;assignment_snapshot:string;status:string};
type Offer={id:string;intent_id:string;offerer_user_id:string;assignment_id:string;assignment_version:string;assignment_snapshot:string;status:string};
type Leg={candidate_id:string;user_id:string;give_assignment_id:string|null;give_version:string|null;give_snapshot:string|null};
const swapPermissions:Record<ExchangeDomain,string>={DUTY_OPS:'duty_ops.swap',FLYVASK:'flyvask.swap',
  BRAKKEVAKT:'brakkevakt.swap'};
const event=(db:D1Database,intentId:string,candidateId:string|null,type:string,reason:string,details:unknown,now:string)=>
  db.prepare('INSERT INTO exchange_v2_events VALUES (?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),intentId,candidateId,null,type,reason,JSON.stringify(details),now);
const candidateEvent=(db:D1Database,candidateId:string,type:string,reason:string,details:unknown,now:string)=>
  db.prepare(`INSERT INTO exchange_v2_events
    SELECT lower(hex(randomblob(16))),ci.intent_id,?,NULL,?,?,?,?
    FROM exchange_v2_candidate_intents ci WHERE ci.candidate_id=?`)
    .bind(candidateId,type,reason,JSON.stringify(details),now,candidateId);
function endReason(domain:ExchangeDomain,snapshot:string,now:Date):'EXPIRED'|'INVALIDATED'{
  try{
    const parsed=JSON.parse(snapshot) as {startsAt:string;endsAt:string};
    return (domain==='BRAKKEVAKT'?parsed.endsAt<=osloDay(now):parsed.startsAt<=now.toISOString())?'EXPIRED':'INVALIDATED';
  }catch{return 'INVALIDATED';}
}
function currentTargetPredicate(domain:ExchangeDomain){
  if(domain==='BRAKKEVAKT')return `EXISTS(SELECT 1 FROM brakkevakt_assignments a
    JOIN brakkevakt_periods p ON p.id=a.period_id WHERE a.id=? AND p.published=1
    AND p.week_start=? AND date(p.week_start,'+7 days')=? AND date(p.week_start,'+7 days')>?)`;
  const prefix=domain==='DUTY_OPS'?'duty_ops':'flyvask';
  return `EXISTS(SELECT 1 FROM ${prefix}_shifts s JOIN ${prefix}_effective_assignments a ON a.shift_id=s.id
    WHERE s.id=? AND s.status='OPEN' AND s.starts_at=? AND s.ends_at=? AND s.starts_at>?)`;
}
async function invalidateIntent(db:D1Database,row:Intent,status:'EXPIRED'|'INVALIDATED',reason:string,now:string){
  const statements=[
    db.prepare(`UPDATE exchange_v2_intents SET status=?,reason=?,updated_at=? WHERE id=? AND status='OPEN'`)
      .bind(status,reason,now,row.id),
    db.prepare(`UPDATE exchange_v2_targets SET status=?,reason=?,updated_at=? WHERE intent_id=? AND status='OPEN'`)
      .bind(status,reason,now,row.id),
    db.prepare(`UPDATE exchange_v2_offers SET status=?,reason=?,updated_at=? WHERE intent_id=? AND status='OPEN'`)
      .bind(status,reason,now,row.id),
    db.prepare(`INSERT INTO exchange_v2_events
      SELECT lower(hex(randomblob(16))),all_links.intent_id,c.id,NULL,?,?,?,?
      FROM exchange_v2_candidates c
      JOIN exchange_v2_candidate_intents source_link ON source_link.candidate_id=c.id
      JOIN exchange_v2_candidate_intents all_links ON all_links.candidate_id=c.id
      WHERE source_link.intent_id=? AND c.status='WAITING'`)
      .bind('CANDIDATE_'+status,reason,JSON.stringify({source:JSON.parse(row.source_snapshot)}),now,row.id),
    db.prepare(`UPDATE exchange_v2_candidates SET status=?,reason=?,updated_at=? WHERE status='WAITING'
      AND id IN (SELECT candidate_id FROM exchange_v2_candidate_intents WHERE intent_id=?)`).bind(status,reason,now,row.id),
    db.prepare(`DELETE FROM user_inbox_items WHERE source_type='EXCHANGE' AND read_at IS NULL
      AND source_id IN (SELECT id FROM exchange_v2_targets WHERE intent_id=?)`).bind(row.id),
    event(db,row.id,null,'INTENT_'+status,reason,{source:JSON.parse(row.source_snapshot)},now),
  ];
  // A concurrent commit/cancel wins. No event is written for a no-op.
  try{await db.batch([db.prepare(`UPDATE exchange_v2_state SET revision=CASE WHEN EXISTS
    (SELECT 1 FROM exchange_v2_intents WHERE id=? AND status='OPEN')
    AND NOT (${currentMemberPredicate(row.domain)} AND ${legacyReservationPredicate(row.domain)})
    THEN revision+1 ELSE -1 END WHERE id=1`).bind(row.id,
      ...memberPredicateValues(row.source_assignment_id,row.owner_user_id,row.source_version,row.domain,new Date(now)),
      row.source_assignment_id,row.owner_user_id),...statements]);}
  catch{/* Another action changed the case. The next read sees current state. */}
}
async function syncTargetInbox(db:D1Database,row:Target,userIds:string[],domain:ExchangeDomain,now:string){
  const membership=domain==='BRAKKEVAKT'
    ? 'brakkevakt_assignments a WHERE a.id=t.assignment_id AND a.user_id='
    : `${domain==='DUTY_OPS'?'duty_ops':'flyvask'}_effective_assignments a
      WHERE a.shift_id=t.assignment_id AND a.user_id=`;
  await db.batch([
    db.prepare(`DELETE FROM user_inbox_items WHERE source_type='EXCHANGE' AND source_id=?
      AND read_at IS NULL AND NOT EXISTS(SELECT 1 FROM exchange_v2_targets t
        JOIN exchange_v2_intents i ON i.id=t.intent_id WHERE t.id=user_inbox_items.source_id
        AND t.status='OPEN' AND i.status='OPEN'
        AND EXISTS(SELECT 1 FROM ${membership}user_inbox_items.user_id))`).bind(row.id),
    ...userIds.map(userId=>db.prepare(`INSERT OR IGNORE INTO user_inbox_items
      (id,user_id,kind,source_type,source_id,created_at)
      SELECT ?,?,'ACTION','EXCHANGE',?,? WHERE EXISTS(SELECT 1 FROM effective_user_permissions
        WHERE user_id=? AND permission_key=?)
      AND EXISTS(SELECT 1 FROM exchange_v2_targets t JOIN exchange_v2_intents i ON i.id=t.intent_id
        WHERE t.id=? AND t.status='OPEN' AND i.status='OPEN'
        AND EXISTS(SELECT 1 FROM ${membership}?))`)
      .bind(crypto.randomUUID(),userId,row.id,now,userId,swapPermissions[domain],row.id,userId)),
  ]);
}
export async function reconcileExchangeV2(db:D1Database,domain:ExchangeDomain,assignmentIds?:string[]){
  const now=new Date(),stamp=now.toISOString();
  const intents=(await db.prepare(`SELECT * FROM exchange_v2_intents WHERE domain=? AND status='OPEN'
    ORDER BY created_at,id`).bind(domain).all<Intent>()).results;
  for(const row of intents){
    if(assignmentIds?.length&& !assignmentIds.includes(row.source_assignment_id))continue;
    if(domain!=='BRAKKEVAKT'&&await hasAssignmentConflict(db,domain,[row.source_assignment_id]))continue;
    const member=(await readMembers(db,domain,row.source_assignment_id)).find(m=>m.userId===row.owner_user_id);
    if(!member||!isExchangeable(domain,member,now)||member.version!==row.source_version||
      await hasLegacyReservation(db,domain,row.source_assignment_id,row.owner_user_id)){
      const status=endReason(domain,row.source_snapshot,now);
      await invalidateIntent(db,row,status,status==='EXPIRED'?'ASSIGNMENT_EXPIRED':
        member&&member.status!=='OPEN'?'SHIFT_CANCELLED':'SOURCE_ASSIGNMENT_CHANGED',stamp);
    }
  }
  const targets=(await db.prepare(`SELECT t.* FROM exchange_v2_targets t JOIN exchange_v2_intents i ON i.id=t.intent_id
    WHERE i.domain=? AND i.status='OPEN' AND t.status='OPEN'`).bind(domain).all<Target>()).results;
  for(const row of targets){
    if(assignmentIds?.length&&!assignmentIds.includes(row.assignment_id))continue;
    if(domain!=='BRAKKEVAKT'&&await hasAssignmentConflict(db,domain,[row.assignment_id]))continue;
    const members=await readMembers(db,domain,row.assignment_id),first=members[0];
    const old=JSON.parse(row.assignment_snapshot) as {startsAt:string;endsAt:string;status:string};
    if(first&&isExchangeable(domain,first,now)&&first.startsAt===old.startsAt&&first.endsAt===old.endsAt){
      await syncTargetInbox(db,row,members.map(member=>member.userId),domain,stamp);
      continue;
    }
    const status=endReason(domain,row.assignment_snapshot,now),reason=status==='EXPIRED'?'ASSIGNMENT_EXPIRED':
      first&&first.status!=='OPEN'?'SHIFT_CANCELLED':'TARGET_ASSIGNMENT_CHANGED';
    try{await db.batch([
      db.prepare(`UPDATE exchange_v2_state SET revision=CASE WHEN EXISTS
        (SELECT 1 FROM exchange_v2_targets WHERE id=? AND status='OPEN')
        AND NOT ${currentTargetPredicate(domain)} THEN revision+1 ELSE -1 END WHERE id=1`)
        .bind(row.id,row.assignment_id,old.startsAt,old.endsAt,domain==='BRAKKEVAKT'?osloDay(now):stamp),
      db.prepare('UPDATE exchange_v2_targets SET status=?,reason=?,updated_at=? WHERE id=?').bind(status,reason,stamp,row.id),
      db.prepare(`UPDATE exchange_v2_candidates SET status=?,reason=?,updated_at=? WHERE target_id=? AND status='WAITING'`)
        .bind(status,reason,stamp,row.id),
      db.prepare("DELETE FROM user_inbox_items WHERE source_type='EXCHANGE' AND source_id=? AND read_at IS NULL").bind(row.id),
      event(db,row.intent_id,null,'TARGET_'+status,reason,{target:old},stamp),
    ]);}catch{/* Concurrent case transition. */}
  }
  const offers=(await db.prepare(`SELECT o.* FROM exchange_v2_offers o JOIN exchange_v2_intents i ON i.id=o.intent_id
    WHERE i.domain=? AND i.status='OPEN' AND o.status='OPEN'`).bind(domain).all<Offer>()).results;
  for(const row of offers){
    if(assignmentIds?.length&&!assignmentIds.includes(row.assignment_id))continue;
    if(domain!=='BRAKKEVAKT'&&await hasAssignmentConflict(db,domain,[row.assignment_id]))continue;
    const member=(await readMembers(db,domain,row.assignment_id)).find(m=>m.userId===row.offerer_user_id);
    if(member&&isExchangeable(domain,member,now)&&member.version===row.assignment_version&&
      !await hasLegacyReservation(db,domain,row.assignment_id,row.offerer_user_id))continue;
    const status=endReason(domain,row.assignment_snapshot,now),reason=status==='EXPIRED'?'ASSIGNMENT_EXPIRED':
      member&&member.status!=='OPEN'?'SHIFT_CANCELLED':'PARTICIPANT_NO_LONGER_ASSIGNED';
    try{await db.batch([
      db.prepare(`UPDATE exchange_v2_state SET revision=CASE WHEN EXISTS
        (SELECT 1 FROM exchange_v2_offers WHERE id=? AND status='OPEN')
        AND NOT (${currentMemberPredicate(domain)} AND ${legacyReservationPredicate(domain)})
        THEN revision+1 ELSE -1 END WHERE id=1`).bind(row.id,
          ...memberPredicateValues(row.assignment_id,row.offerer_user_id,row.assignment_version,domain,now),
          row.assignment_id,row.offerer_user_id),
      db.prepare('UPDATE exchange_v2_offers SET status=?,reason=?,updated_at=? WHERE id=?').bind(status,reason,stamp,row.id),
      db.prepare(`UPDATE exchange_v2_candidates SET status=?,reason=?,updated_at=? WHERE offer_id=? AND status='WAITING'`)
        .bind(status,reason,stamp,row.id),
      db.prepare(`DELETE FROM user_inbox_items WHERE source_type='EXCHANGE' AND read_at IS NULL
        AND source_id IN (SELECT id FROM exchange_v2_candidates WHERE offer_id=?)`).bind(row.id),
      event(db,row.intent_id,null,'OFFER_'+status,reason,{offerId:row.id,assignment:JSON.parse(row.assignment_snapshot)},stamp),
    ]);}catch{/* Concurrent case transition. */}
  }
  const candidateLegs=(await db.prepare(`SELECT l.* FROM exchange_v2_candidate_legs l JOIN exchange_v2_candidates c ON c.id=l.candidate_id
    WHERE c.domain=? AND c.status='WAITING' AND l.give_assignment_id IS NOT NULL`)
    .bind(domain).all<Leg>()).results;
  for(const leg of candidateLegs){
    if(assignmentIds?.length&&!assignmentIds.includes(leg.give_assignment_id!))continue;
    if(domain!=='BRAKKEVAKT'&&await hasAssignmentConflict(db,domain,[leg.give_assignment_id!]))continue;
    const member=(await readMembers(db,domain,leg.give_assignment_id!)).find(m=>m.userId===leg.user_id);
    if(member&&isExchangeable(domain,member,now)&&member.version===leg.give_version&&
      !await hasLegacyReservation(db,domain,leg.give_assignment_id!,leg.user_id))continue;
    const status=endReason(domain,leg.give_snapshot!,now),reason=status==='EXPIRED'?'ASSIGNMENT_EXPIRED':
      member&&member.status!=='OPEN'?'SHIFT_CANCELLED':'PARTICIPANT_NO_LONGER_ASSIGNED';
    try{await db.batch([
      db.prepare(`UPDATE exchange_v2_state SET revision=CASE WHEN EXISTS
        (SELECT 1 FROM exchange_v2_candidates WHERE id=? AND status='WAITING')
        AND NOT (${currentMemberPredicate(domain)} AND ${legacyReservationPredicate(domain)})
        THEN revision+1 ELSE -1 END WHERE id=1`).bind(leg.candidate_id,
          ...memberPredicateValues(leg.give_assignment_id!,leg.user_id,leg.give_version!,domain,now),
          leg.give_assignment_id,leg.user_id),
      db.prepare(`UPDATE exchange_v2_candidates SET status=?,reason=?,updated_at=? WHERE id=?`).bind(status,reason,stamp,leg.candidate_id),
      db.prepare("DELETE FROM user_inbox_items WHERE source_type='EXCHANGE' AND source_id=? AND read_at IS NULL")
        .bind(leg.candidate_id),
      candidateEvent(db,leg.candidate_id,'CANDIDATE_'+status,reason,{leg:{userId:leg.user_id,
        assignment:JSON.parse(leg.give_snapshot!)}},stamp),
    ]);}catch{/* Concurrent case transition. */}
  }
}

// Older schema fixtures and migration-before-deploy windows can still execute
// the legacy sync code. The current production schema always has this table.
export async function reconcileExchangeV2IfInstalled(db:D1Database,domain:ExchangeDomain,assignmentIds?:string[]){
  try{
    const installed=await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='exchange_v2_intents'").first();
    if(installed)await reconcileExchangeV2(db,domain,assignmentIds);
  }catch(error){console.error('Exchange v2 reconciliation failed after a completed domain write',error);}
}
