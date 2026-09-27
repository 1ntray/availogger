import { FlightLoggerError } from './client';

export interface DutyMeeting {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  externalReference: string | null;
  participantCount: number;
}
export interface FlightLoggerProfile { id: string; firstName: string | null; lastName: string | null }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 256): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const nullableName = (v: unknown) => v === null || (typeof v === 'string' && v.length <= 256);
const invalid = () => new FlightLoggerError('FlightLogger returned an invalid Duty Ops record.');

export function parseSelfProfile(value: unknown): FlightLoggerProfile {
  if (!object(value) || !text(value.id) || !nullableName(value.firstName) || !nullableName(value.lastName)) throw invalid();
  return { id: value.id, firstName: value.firstName as string | null, lastName: value.lastName as string | null };
}

export function parseDutyMeeting(value: unknown): DutyMeeting | null {
  if (!object(value) || !text(value.__typename)) throw invalid();
  if (value.__typename !== 'MeetingBooking') return null;
  const timestamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
  if (!text(value.id) || !timestamp(value.startsAt) || !timestamp(value.endsAt) || Date.parse(value.startsAt) >= Date.parse(value.endsAt) ||
      !['OPEN', 'CANCELLED', 'COMPLETED', 'PARTIALLY_COMPLETED'].includes(value.status as string) ||
      !(value.externalReference === null || (typeof value.externalReference === 'string' && value.externalReference.length <= 2048)) ||
      !Array.isArray(value.participants) || value.participants.length > 500 ||
      !value.participants.every(p => p === null || (object(p) && text(p.id) && nullableName(p.firstName) && nullableName(p.lastName))) ||
      !(object(value.classroom) && text(value.classroom.id) && text(value.classroom.name))) throw invalid();
  // An unreadable classroom makes discovery incomplete: do not interpret a
  // masked location as proof that a previously known Duty Ops shift disappeared.
  if (value.classroom.id !== '852') return null;
  // Deliberately discard every participant identity, even if FlightLogger exposes it.
  // all:false association establishes only the requesting student's membership.
  return { id: value.id, startsAt: new Date(value.startsAt).toISOString(), endsAt: new Date(value.endsAt).toISOString(),
    status: value.status as string, externalReference: value.externalReference as string | null, participantCount: value.participants.length };
}
