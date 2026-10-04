import { ApplicationError } from './application-error';

export type AssignmentDomain = 'DUTY_OPS' | 'FLYVASK';
export type ParticipantIntegrity = {
  status: 'CONSISTENT' | 'PARTIAL' | 'CONFLICT';
  reason: null | 'IDENTITIES_INCOMPLETE' | 'RAW_IDENTITY_OVERCOUNT' | 'PORTAL_SOURCE_DIVERGED' | 'PORTAL_LINEAGE_UNVERIFIED';
};
export const assignmentConflict = () => new ApplicationError(
  'Assignment information differs from FlightLogger and is still being reconciled. Try again after the schedule has synchronized.',
  409, 'EXCHANGE_ASSIGNMENT_SYNC_CONFLICT');
export async function conflictedAssignmentIds(db: D1Database, domain: AssignmentDomain, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.prepare(`SELECT shift_id FROM assignment_reconciliation
    WHERE domain=? AND status='CONFLICT' AND shift_id IN (SELECT value FROM json_each(?))`)
    .bind(domain, JSON.stringify(ids)).all<{shift_id:string}>();
  return new Set(rows.results.map(row => row.shift_id));
}
export async function hasAssignmentConflict(db: D1Database, domain: AssignmentDomain, ids: string[]): Promise<boolean> {
  return (await conflictedAssignmentIds(db,domain,ids)).size>0;
}
export interface AssignmentParticipant {
  userId: string; firstName: string | null; lastName: string | null; isCurrentUser: boolean;
}
type Row = { shift_id: string; user_id: string; flightlogger_user_id: string | null;
  flightlogger_first_name: string | null; flightlogger_last_name: string | null };
type IntegrityRow = { shift_id: string; participant_count: number; raw_count: number; slot_count: number;
  status: ParticipantIntegrity['status']; reason: ParticipantIntegrity['reason']; assignments_differ: number };

const tables = {
  DUTY_OPS: { raw: 'duty_ops_assignments', effective: 'duty_ops_effective_assignments' },
  FLYVASK: { raw: 'flyvask_assignments', effective: 'flyvask_effective_assignments' },
} as const;

// Both domains use the same D1 reconciliation view for presentation and guards.
export async function readAssignmentStates(db: D1Database, domain: AssignmentDomain, shiftIds: string[], currentUserId: string) {
  const { raw, effective } = tables[domain];
  const ids = JSON.stringify(shiftIds);
  const peopleQuery = (table: string) => db.prepare(`
    SELECT a.shift_id,a.user_id,u.flightlogger_user_id,u.flightlogger_first_name,u.flightlogger_last_name
    FROM ${table} a JOIN users u ON u.id=a.user_id
    WHERE a.shift_id IN (SELECT value FROM json_each(?))
    ORDER BY u.flightlogger_first_name,u.flightlogger_last_name,u.id`).bind(ids);
  const result = await db.batch([
    peopleQuery(raw), peopleQuery(effective),
    db.prepare(`SELECT shift_id,participant_count,raw_count,slot_count,status,reason,assignments_differ
      FROM assignment_reconciliation WHERE domain=? AND shift_id IN (SELECT value FROM json_each(?))`).bind(domain, ids),
  ]);
  const group = (rows: Row[]) => {
    const grouped = new Map<string, Map<string, Row>>();
    for (const row of rows) {
      const members = grouped.get(row.shift_id) ?? new Map<string, Row>();
      const identity = row.flightlogger_user_id ?? `portal:${row.user_id}`;
      const prior = members.get(identity);
      if (!prior || row.user_id === currentUserId ||
        (prior.user_id !== currentUserId && !prior.flightlogger_first_name && row.flightlogger_first_name))
        members.set(identity, row);
      grouped.set(row.shift_id, members);
    }
    return grouped;
  };
  const before = group(result[0].results as Row[]), after = group(result[1].results as Row[]);
  const integrity = new Map((result[2].results as IntegrityRow[]).map(row => [row.shift_id, row]));
  const participants = (rows: Map<string, Row> | undefined): AssignmentParticipant[] => [...(rows?.values() ?? [])].map(row => ({
    userId: row.user_id, firstName: row.flightlogger_first_name, lastName: row.flightlogger_last_name,
    isCurrentUser: row.user_id === currentUserId,
  }));
  const conflictIds = [...integrity.values()].filter(row => row.status === 'CONFLICT').map(row => row.shift_id);
  const sources = conflictIds.length ? (await db.prepare(`SELECT shift_id,source_type,source_id,replacement_user_id
    FROM assignment_transfer_final WHERE domain=? AND shift_id IN (SELECT value FROM json_each(?))`)
    .bind(domain,JSON.stringify(conflictIds)).all<{shift_id:string;source_type:string;source_id:string;replacement_user_id:string}>()).results : [];
  for (const row of integrity.values()) if (row.status === 'CONFLICT') {
    console.warn('Assignment reconciliation conflict', JSON.stringify({
      domain, assignmentId: row.shift_id, participantCount: row.participant_count,
      knownIdentityCount: row.raw_count, portalSlotCount: row.slot_count, reason: row.reason,
      sources: sources.filter(source => source.shift_id === row.shift_id).map(source => ({type:source.source_type,id:source.source_id})),
    }));
  }
  return (shiftId: string, participantCount: number) => {
    const row = integrity.get(shiftId);
    const state: ParticipantIntegrity = row?.status === 'CONFLICT'
      ? { status: 'CONFLICT', reason: row.reason }
      : row?.status === 'PARTIAL'
        ? { status: 'PARTIAL', reason: 'IDENTITIES_INCOMPLETE' }
        : { status: 'CONSISTENT', reason: null };
    const finalOwners = new Set(sources.filter(source => source.shift_id === shiftId).map(source => source.replacement_user_id));
    const safeAfter = state.status === 'CONFLICT'
      ? state.reason !== 'PORTAL_LINEAGE_UNVERIFIED'
        ? participants(after.get(shiftId)).filter(person => finalOwners.has(person.userId))
        : []
      : participants(after.get(shiftId));
    const safeBefore = state.status === 'CONFLICT' ? [] : participants(before.get(shiftId));
    return {
      participants: safeAfter, participantCount,
      flightlogger: { participants: safeBefore, participantCount },
      assignmentsDiffer: Boolean(row?.assignments_differ), participantIntegrity: state,
      isCurrentUserAssigned: safeAfter.some(person => person.isCurrentUser),
    };
  };
}
