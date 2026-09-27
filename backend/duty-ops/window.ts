import { ApplicationError } from '../application-error';
import { addDays, inclusiveDayCount, osloMidnight } from '../flightlogger/calendar';

export interface DutyWindow { from: string; to: string; startsAt: string; endsAt: string }
export const MAX_DUTY_WINDOW_DAYS = 93;
const osloDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

export function dutyWindow(url: URL, now = new Date()): DutyWindow {
  for (const key of url.searchParams.keys()) {
    if (!['from', 'to'].includes(key) || url.searchParams.getAll(key).length !== 1) throw new ApplicationError('Unsupported Duty Ops query parameters.', 400);
  }
  const parts = osloDateFormatter.formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const suppliedFrom = url.searchParams.get('from');
  const suppliedTo = url.searchParams.get('to');
  if ((suppliedFrom === null) !== (suppliedTo === null)) throw new ApplicationError('Provide both from and to dates.', 400);
  const from = suppliedFrom ?? addDays(today, -30);
  const to = suppliedTo ?? addDays(today, 60);
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  if (!valid(from) || !valid(to) || from > to || inclusiveDayCount(from, to) > MAX_DUTY_WINDOW_DAYS) {
    throw new ApplicationError(`Use valid YYYY-MM-DD dates spanning at most ${MAX_DUTY_WINDOW_DAYS} days.`, 400);
  }
  return { from, to, startsAt: new Date(osloMidnight(from)).toISOString(), endsAt: new Date(osloMidnight(addDays(to, 1))).toISOString() };
}
