import { readAssignmentStates as readSharedStates, type AssignmentParticipant } from '../assignment-reconciliation';

export const effectiveAssignments = 'flyvask_effective_assignments';
export const activeReservations = 'flyvask_active_swap_reservations';
export type FlyvaskParticipant = AssignmentParticipant;
export const readAssignmentStates = (db: D1Database, shiftIds: string[], currentUserId: string) =>
  readSharedStates(db, 'FLYVASK', shiftIds, currentUserId);
