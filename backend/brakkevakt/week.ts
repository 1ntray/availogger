import { ApplicationError } from '../application-error';
const oslo = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });
export function osloDay(now = new Date()): string {
  const parts = oslo.formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function plusDays(day: string, amount: number): string {
  const value = new Date(`${day}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
export function currentWeekStart(now = new Date()): string {
  const day = osloDay(now), weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay();
  return plusDays(day, -((weekday + 6) % 7));
}
export function validWeekStart(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00.000Z`)) && new Date(`${value}T12:00:00.000Z`).toISOString().slice(0, 10) === value &&
    new Date(`${value}T12:00:00.000Z`).getUTCDay() === 1;
}
export function requireWeek(value: unknown): string {
  if (!validWeekStart(value)) throw new ApplicationError('Choose a Monday in Europe/Oslo.', 400, 'INVALID_BRAKKEVAKT_WEEK');
  return value;
}
export function weekActive(weekStart: string, now = new Date()): boolean { return plusDays(weekStart, 7) > osloDay(now); }
