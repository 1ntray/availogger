export interface FlyvaskShift {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'OPEN' | 'CANCELLED' | 'COMPLETED' | 'PARTIALLY_COMPLETED';
  participantCount: number;
  participants: { userId: string; firstName: string | null; lastName: string | null; isCurrentUser: boolean }[];
  classroomId: string | null; classroomName: string | null;
  flightlogger: { participantCount: number; participants: FlyvaskShift['participants'] };
  assignmentsDiffer: boolean;
  participantIntegrity?: { status: 'CONSISTENT' | 'PARTIAL' | 'CONFLICT'; reason: null | 'IDENTITIES_INCOMPLETE' | 'RAW_IDENTITY_OVERCOUNT' | 'PORTAL_SOURCE_DIVERGED' | 'PORTAL_LINEAGE_UNVERIFIED' };
  isCurrentUserAssigned?: boolean;
}
export interface FlyvaskData {
  from: string; to: string; timeZone: 'Europe/Oslo'; shifts: FlyvaskShift[];
  sync: { stale: boolean; warning: string | null;
    discovery: { lastSyncedAt: string; stale: boolean; from: string; to: string };
    assignments: { lastSyncedAt: string; stale: boolean; from: string; to: string } };
}
