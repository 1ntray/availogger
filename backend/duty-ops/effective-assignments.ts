import { readAssignmentStates as readSharedStates, type AssignmentParticipant } from '../assignment-reconciliation';

export const effectiveAssignments = 'duty_ops_effective_assignments';
export const activeReservations = 'duty_ops_active_swap_reservations';
export type DutyParticipant = AssignmentParticipant;
export const readAssignmentStates = (db: D1Database, shiftIds: string[], currentUserId: string) =>
  readSharedStates(db, 'DUTY_OPS', shiftIds, currentUserId);
