import { ApplicationError } from '../application-error';
import type { ExchangeAssignmentSnapshot, ExchangeDomain } from '../../shared/exchange-v2';
import { osloDay } from '../brakkevakt/week';

export interface AssignmentMember extends ExchangeAssignmentSnapshot { userId: string; identity: string; periodId: string | null }

const memberSql: Record<ExchangeDomain, string> = {
  DUTY_OPS: `SELECT s.id, s.starts_at startsAt, s.ends_at endsAt, s.status, a.user_id userId,
    COALESCE(u.flightlogger_user_id,'portal:'||u.id) identity, NULL periodId,
    json_array(s.starts_at,s.ends_at,s.status,COALESCE((SELECT x.accepted_at||':'||x.exchange_id
      FROM duty_ops_assignment_effects x JOIN users xu ON xu.id=x.user_id
      WHERE x.shift_id=s.id AND COALESCE(xu.flightlogger_user_id,'portal:'||xu.id)=COALESCE(u.flightlogger_user_id,'portal:'||u.id)
      ORDER BY x.accepted_at DESC,x.exchange_id DESC LIMIT 1),'RAW')) version
    FROM duty_ops_shifts s JOIN duty_ops_effective_assignments a ON a.shift_id=s.id JOIN users u ON u.id=a.user_id WHERE s.id=?`,
  FLYVASK: `SELECT s.id, s.starts_at startsAt, s.ends_at endsAt, s.status, a.user_id userId,
    COALESCE(u.flightlogger_user_id,'portal:'||u.id) identity, NULL periodId,
    json_array(s.starts_at,s.ends_at,s.status,COALESCE((SELECT x.accepted_at||':'||x.exchange_id
      FROM flyvask_assignment_effects x JOIN users xu ON xu.id=x.user_id
      WHERE x.shift_id=s.id AND COALESCE(xu.flightlogger_user_id,'portal:'||xu.id)=COALESCE(u.flightlogger_user_id,'portal:'||u.id)
      ORDER BY x.accepted_at DESC,x.exchange_id DESC LIMIT 1),'RAW')) version
    FROM flyvask_shifts s JOIN flyvask_effective_assignments a ON a.shift_id=s.id JOIN users u ON u.id=a.user_id WHERE s.id=?`,
  BRAKKEVAKT: `SELECT a.id, w.week_start startsAt, date(w.week_start,'+7 days') endsAt,
    CASE WHEN w.published=1 THEN 'OPEN' ELSE 'DRAFT' END status, a.user_id userId,
    COALESCE(u.flightlogger_user_id,'portal:'||u.id) identity, w.id periodId,
    json_array(w.week_start,w.revision,w.published,a.updated_at) version
    FROM brakkevakt_assignments a JOIN brakkevakt_periods w ON w.id=a.period_id JOIN users u ON u.id=a.user_id WHERE a.id=?`,
};

export function isExchangeable(domain: ExchangeDomain, row: AssignmentMember, now = new Date()): boolean {
  if (row.status !== 'OPEN') return false;
  return domain === 'BRAKKEVAKT' ? row.endsAt > osloDay(now) : row.startsAt > now.toISOString();
}

export async function readMembers(db: D1Database, domain: ExchangeDomain, assignmentId: string): Promise<AssignmentMember[]> {
  const rows = await db.prepare(memberSql[domain]).bind(assignmentId).all<AssignmentMember>();
  return rows.results;
}

export async function readOwned(db: D1Database, domain: ExchangeDomain, assignmentId: string, userId: string,
  now = new Date()): Promise<AssignmentMember> {
  const member = (await readMembers(db, domain, assignmentId)).find(row => row.userId === userId);
  if (!member || !isExchangeable(domain, member, now))
    throw new ApplicationError('This assignment is no longer available for exchange.', 409, 'EXCHANGE_ASSIGNMENT_CHANGED');
  return member;
}

export function snapshot(member: AssignmentMember): ExchangeAssignmentSnapshot {
  return { id: member.id, startsAt: member.startsAt, endsAt: member.endsAt, status: member.status,
    ...(member.periodId ? { weekStart: member.startsAt } : {}), version: member.version };
}

// Reused by the guarded final batch. A pre-read alone can never authorize a commit.
export function currentMemberPredicate(domain: ExchangeDomain): string {
  return `EXISTS (SELECT 1 FROM (${memberSql[domain]}) current
    WHERE current.userId=? AND current.version=? AND current.status='OPEN'
    AND ${domain === 'BRAKKEVAKT' ? "current.endsAt>?" : 'current.startsAt>?'})`;
}

export function memberPredicateValues(assignmentId: string, userId: string, version: string, domain: ExchangeDomain, now: Date): string[] {
  return [assignmentId, userId, version, domain === 'BRAKKEVAKT' ? osloDay(now) : now.toISOString()];
}

export function legacyReservationPredicate(domain: ExchangeDomain): string {
  return domain === 'BRAKKEVAKT'
    ? 'NOT EXISTS(SELECT 1 FROM brakkevakt_swap_reservations WHERE assignment_id=? AND user_id=?)'
    : `NOT EXISTS(SELECT 1 FROM ${domain === 'DUTY_OPS' ? 'duty_ops' : 'flyvask'}_active_swap_reservations
      WHERE shift_id=? AND user_id=?)`;
}
export async function hasLegacyReservation(db:D1Database,domain:ExchangeDomain,assignmentId:string,userId:string):Promise<boolean>{
  const table=domain==='BRAKKEVAKT'?'brakkevakt_swap_reservations':
    `${domain==='DUTY_OPS'?'duty_ops':'flyvask'}_active_swap_reservations`;
  const key=domain==='BRAKKEVAKT'?'assignment_id':'shift_id';
  return !!await db.prepare(`SELECT 1 FROM ${table} WHERE ${key}=? AND user_id=?`).bind(assignmentId,userId).first();
}
