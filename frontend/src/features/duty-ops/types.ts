export interface DutyShift {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'OPEN' | 'CANCELLED' | 'COMPLETED' | 'PARTIALLY_COMPLETED';
  participantCount: number;
  participants: { userId: string; firstName: string | null; lastName: string | null; isCurrentUser: boolean }[];
}
export interface DutyOpsData {
  from: string; to: string; timeZone: 'Europe/Oslo'; shifts: DutyShift[];
  sync: { stale: boolean; warning: string | null;
    discovery: { lastSyncedAt: string; stale: boolean; from: string; to: string };
    assignments: { lastSyncedAt: string; stale: boolean; from: string; to: string } };
}
