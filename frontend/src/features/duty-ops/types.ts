export interface DutyShift {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'OPEN' | 'CANCELLED' | 'COMPLETED' | 'PARTIALLY_COMPLETED';
  participantCount: number;
  participants: { userId: string; firstName: string | null; lastName: string | null; isCurrentUser: boolean }[];
  // Optional during a rolling release with an older API; participants is primary.
  flightlogger?: { participantCount: number; participants: DutyShift['participants'] };
  assignmentsDiffer?: boolean;
  participantIntegrity?: { status: 'CONSISTENT' | 'PARTIAL' | 'CONFLICT'; reason: null | 'IDENTITIES_INCOMPLETE' | 'RAW_IDENTITY_OVERCOUNT' | 'PORTAL_SOURCE_DIVERGED' | 'PORTAL_LINEAGE_UNVERIFIED' };
  isCurrentUserAssigned?: boolean;
}
export interface DutyOpsData {
  from: string; to: string; timeZone: 'Europe/Oslo'; shifts: DutyShift[];
  sync: { stale: boolean; warning: string | null;
    discovery: { lastSyncedAt: string; stale: boolean; from: string; to: string };
    assignments: { lastSyncedAt: string; stale: boolean; from: string; to: string } };
}
