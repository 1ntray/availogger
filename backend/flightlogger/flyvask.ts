import { FlightLoggerError } from './client';

export interface FlyvaskMeeting {
  id: string; startsAt: string; endsAt: string; status: string;
  externalReference: string | null; participantCount: number;
  classroomId: string | null; classroomName: string | null;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 256): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const nullable = (v: unknown, max = 256) => v === null || (typeof v === 'string' && v.length <= max);
const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const invalid = () => new FlightLoggerError('FlightLogger returned an invalid Flyvask record.');

export function parseFlyvaskMeeting(value: unknown): FlyvaskMeeting | null {
  if (!object(value) || !text(value.__typename)) throw invalid();
  if (value.__typename !== 'MeetingBooking') return null;
  if (!nullable(value.comment, 4096)) throw invalid();
  // Location never decides inclusion. An unreadable comment is not a complete
  // discovery response; an explicit null comment is an unrelated meeting.
  if (value.comment === null || (value.comment as string).trim().toUpperCase() !== 'FLYVASK') return null;
  if (!text(value.id) || !timestamp(value.startsAt) || !timestamp(value.endsAt) || Date.parse(value.startsAt) >= Date.parse(value.endsAt) ||
      !['OPEN', 'CANCELLED', 'COMPLETED', 'PARTIALLY_COMPLETED'].includes(value.status as string) ||
      !nullable(value.externalReference, 2048) || !Array.isArray(value.participants) || value.participants.length > 500 ||
      !value.participants.every(p => p === null || (object(p) && text(p.id) && nullable(p.firstName) && nullable(p.lastName))) ||
      !(value.classroom === null || (object(value.classroom) && text(value.classroom.id) && nullable(value.classroom.name)))) throw invalid();
  // Discard all discovery identities. all:false establishes only actor membership.
  return { id: value.id, startsAt: new Date(value.startsAt).toISOString(), endsAt: new Date(value.endsAt).toISOString(),
    status: value.status as string, externalReference: value.externalReference as string | null, participantCount: value.participants.length,
    classroomId: value.classroom === null ? null : (value.classroom as Record<string, unknown>).id as string,
    classroomName: value.classroom === null ? null : (value.classroom as Record<string, unknown>).name as string | null };
}
