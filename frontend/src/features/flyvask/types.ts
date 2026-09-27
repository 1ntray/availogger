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
}
export interface FlyvaskData {
  from: string; to: string; timeZone: 'Europe/Oslo'; shifts: FlyvaskShift[];
  sync: { stale: boolean; warning: string | null;
    discovery: { lastSyncedAt: string; stale: boolean; from: string; to: string };
    assignments: { lastSyncedAt: string; stale: boolean; from: string; to: string } };
}
