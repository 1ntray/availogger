import { ApplicationError } from '../application-error';
import { addDays, inclusiveDayCount, osloMidnight } from '../flightlogger/calendar';

export interface FlightWindow { from: string; to: string; startsAt: string; endsAt: string }
export function flightWindow(url: URL, now = new Date()): FlightWindow {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Oslo',year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(now);
  const today = `${parts.find(p=>p.type==='year')!.value}-${parts.find(p=>p.type==='month')!.value}-${parts.find(p=>p.type==='day')!.value}`;
  for (const key of url.searchParams.keys()) if (!['from','to'].includes(key) || url.searchParams.getAll(key).length !== 1) throw new ApplicationError('Unsupported flight query parameters.',400);
  const from = url.searchParams.get('from') ?? addDays(today,-7), to = url.searchParams.get('to') ?? addDays(today,60);
  if (url.searchParams.has('from') !== url.searchParams.has('to')) throw new ApplicationError('Provide both dates.',400);
  const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(`${s}T00:00:00Z`))&&new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s;
  if (!valid(from)||!valid(to)||from>to||inclusiveDayCount(from,to)>93) throw new ApplicationError('Use dates spanning at most 93 days.',400);
  return {from,to,startsAt:new Date(osloMidnight(from)).toISOString(),endsAt:new Date(osloMidnight(addDays(to,1))).toISOString()};
}
