import { FlightLoggerError } from './client';

export interface StudentFlight {
  id: string; bookingType: 'SingleStudentBooking' | 'MultiStudentBooking';
  startsAt: string; endsAt: string; flightStartsAt: string | null; flightEndsAt: string | null;
  status: 'OPEN' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'CANCELLED';
  aircraft: { id: string; callSign: string | null; model: string | null; aircraftClass: string | null;
    aircraftType: string | null; fuelCoefficientMeasurement: string | null } | null;
  departureAirport: { id: string; name: string | null } | null;
  arrivalAirport: { id: string; name: string | null } | null;
  instructor: { id: string; firstName: string | null; lastName: string | null } | null;
  plannedLessons?: PlannedLesson[];
  // Only identifiers are retained long enough to prove the authenticated student.
  studentIds: string[];
}
export type PlannedLesson = { trainingId: string; trainingName: string; lectureId: string | null; lectureName: string | null };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 256): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const sourceId = (v: unknown): string | null => text(v,128) ? v :
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
const nullable = (v: unknown, max = 256) => v === null || (typeof v === 'string' && v.length <= max);
const utc = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 19) === v.slice(0, 19);
const invalid = () => new FlightLoggerError('FlightLogger returned an invalid flight record.');
function airport(value: unknown) {
  if (value === null) return null;
  if (!object(value) || !text(value.id) || !nullable(value.name)) throw invalid();
  return { id: value.id, name: value.name as string | null };
}
function person(value: unknown) {
  if (value === null) return null;
  if (!object(value) || !text(value.id) || !nullable(value.firstName) || !nullable(value.lastName)) throw invalid();
  return { id: value.id, firstName: value.firstName as string | null, lastName: value.lastName as string | null };
}
function plannedLesson(value: unknown): PlannedLesson {
  if (!object(value) || sourceId(value.id)===null || !text(value.name,256) ||
    !(value.lecture === null || (object(value.lecture) && sourceId(value.lecture.id)!==null && text(value.lecture.name,256)))) throw invalid();
  const lecture=value.lecture as Record<string,unknown>|null;
  return { trainingId:sourceId(value.id)!, trainingName:value.name.trim(),
    lectureId:lecture===null ? null : sourceId(lecture.id),
    lectureName:lecture===null ? null : (lecture.name as string).trim() };
}
function lessons(value: Record<string,unknown>): PlannedLesson[] {
  const source=value.__typename === 'SingleStudentBooking' ? value.plannedLesson : value.plannedLessons;
  if (source === undefined || source === null) return [];
  const nodes=value.__typename === 'SingleStudentBooking' ? [source] : source;
  if (!Array.isArray(nodes) || nodes.length > 8) throw invalid();
  const parsed=nodes.map(plannedLesson);
  if (new Set(parsed.map(item=>item.trainingId)).size !== parsed.length) throw invalid();
  return parsed;
}
export function parseStudentFlight(value: unknown): StudentFlight | null {
  if (!object(value) || !text(value.__typename)) throw invalid();
  if (value.__typename !== 'SingleStudentBooking' && value.__typename !== 'MultiStudentBooking') return null;
  if (!text(value.id) || !utc(value.startsAt) || !utc(value.endsAt) || Date.parse(value.startsAt) >= Date.parse(value.endsAt) ||
    !(value.flightStartsAt === null || utc(value.flightStartsAt)) || !(value.flightEndsAt === null || utc(value.flightEndsAt)) ||
    (value.flightStartsAt !== null && value.flightEndsAt !== null && Date.parse(value.flightStartsAt as string) >= Date.parse(value.flightEndsAt as string)) ||
    !['OPEN','COMPLETED','PARTIALLY_COMPLETED','CANCELLED'].includes(value.status as string)) throw invalid();
  let aircraft: StudentFlight['aircraft'] = null;
  if (value.aircraft !== null) {
    const a = value.aircraft;
    if (!object(a) || !text(a.id) || !nullable(a.callSign) || !nullable(a.model) || !nullable(a.aircraftClass) ||
      !nullable(a.aircraftType) || !nullable(a.fuelCoefficientMeasurement) ||
      !(a.homeAirport === null || (object(a.homeAirport) && text(a.homeAirport.id) && nullable(a.homeAirport.name)))) throw invalid();
    aircraft = { id:a.id, callSign:a.callSign as string | null, model:a.model as string | null,
      aircraftClass:a.aircraftClass as string | null, aircraftType:a.aircraftType as string | null,
      fuelCoefficientMeasurement:a.fuelCoefficientMeasurement as string | null };
  }
  const instructor = person(value.instructor);
  const departureAirport = airport(value.departureAirport), arrivalAirport = airport(value.arrivalAirport);
  const students = value.__typename === 'SingleStudentBooking' ? [value.student] : value.students;
  if (!Array.isArray(students) || students.length > 20) throw invalid();
  const studentIds = students.map(s => person(s)?.id).filter((id): id is string => !!id);
  return { id:value.id, bookingType:value.__typename, startsAt:new Date(value.startsAt).toISOString(), endsAt:new Date(value.endsAt).toISOString(),
    flightStartsAt:value.flightStartsAt === null ? null : new Date(value.flightStartsAt as string).toISOString(),
    flightEndsAt:value.flightEndsAt === null ? null : new Date(value.flightEndsAt as string).toISOString(),
    status:value.status as StudentFlight['status'], aircraft, departureAirport, arrivalAirport, instructor,
    plannedLessons:lessons(value),studentIds };
}
