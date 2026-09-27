// The SQL views in 0006 are the single assignment authority used both inside
// mutation guards and for presentation. No JS reconstruction of exchange state.
export const effectiveAssignments = 'duty_ops_effective_assignments';
export const activeReservations = 'duty_ops_active_swap_reservations';
export interface DutyParticipant {
  userId: string; firstName: string | null; lastName: string | null; isCurrentUser: boolean;
}
type Row = {
  shift_id: string; user_id: string; flightlogger_user_id: string | null;
  flightlogger_first_name: string | null; flightlogger_last_name: string | null;
};
export async function readAssignmentStates(db: D1Database, shiftIds: string[], currentUserId: string) {
  // D1 batch reads raw/effective lists from the same transactional snapshot.
  const result = await db.batch([ 'duty_ops_assignments', effectiveAssignments ].map(table => db.prepare(`
    SELECT a.shift_id, a.user_id, u.flightlogger_user_id, u.flightlogger_first_name, u.flightlogger_last_name
    FROM ${table} a JOIN users u ON u.id = a.user_id
    WHERE a.shift_id IN (SELECT value FROM json_each(?))
    ORDER BY u.flightlogger_first_name, u.flightlogger_last_name, u.id`).bind(JSON.stringify(shiftIds))));
  function group(rows: Row[]) {
    const groups = new Map<string, Map<string, Row>>();
    for (const row of rows) {
      const users = groups.get(row.shift_id) ?? new Map<string, Row>();
      const identity = row.flightlogger_user_id ?? row.user_id;
      if (!users.has(identity) || row.user_id === currentUserId) users.set(identity, row);
      groups.set(row.shift_id, users);
    }
    return groups;
  }
  const raw = group(result[0].results as Row[]), effective = group(result[1].results as Row[]);
  const people = (group: Map<string, Row> | undefined): DutyParticipant[] => [...(group?.values() ?? [])].map(p => ({
    userId: p.user_id, firstName: p.flightlogger_first_name, lastName: p.flightlogger_last_name, isCurrentUser: p.user_id === currentUserId,
  }));
  return (shiftId: string, participantCount: number) => {
    const before = raw.get(shiftId), after = effective.get(shiftId);
    const changed = before?.size !== after?.size || [...(before?.keys() ?? [])].some(key => !after?.has(key));
    // Transfers replace a membership, never add a slot. Count unknown participants
    // from the source count, even during partial cross-account catch-up snapshots.
    return { participants: people(after), participantCount: Math.max(participantCount, after?.size ?? 0),
      flightlogger: { participants: people(before), participantCount }, assignmentsDiffer: changed };
  };
}
