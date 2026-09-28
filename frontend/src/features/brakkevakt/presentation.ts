import { displayName } from '../../../../shared/display-name';
import type { BrakkevaktPerson, BrakkevaktWeek } from '../../../../shared/brakkevakt';
const fmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const full = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const personName = (person: BrakkevaktPerson) => displayName(person);
export function addDays(day: string, count: number) { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10); }
export function weekLabel(weekStart: string, year = false) {
  const start = new Date(`${weekStart}T12:00:00Z`), end = new Date(`${addDays(weekStart, 6)}T12:00:00Z`);
  return `${year ? full.format(start) : fmt.format(start)} – ${year ? full.format(end) : fmt.format(end)}`;
}
export function weekNumber(weekStart: string) {
  const thursday = new Date(`${addDays(weekStart, 3)}T12:00:00Z`);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1, 12));
  return Math.floor((thursday.getTime() - yearStart.getTime()) / 604800000) + 1;
}
export function weekTitle(weekStart: string) { return `Week ${weekNumber(weekStart)} · ${weekLabel(weekStart, true)}`; }
const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'UTC' });
const shortMonth = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
export function compactWeekTitle(weekStart: string, referenceYear = new Date().getUTCFullYear()) {
  const start = new Date(`${weekStart}T12:00:00Z`);
  const end = new Date(`${addDays(weekStart, 6)}T12:00:00Z`);
  const startLabel = `${shortDay.format(start)}${start.getUTCMonth() !== end.getUTCMonth() ? ` ${shortMonth.format(start)}` : ''}`;
  const year = end.getUTCFullYear() !== referenceYear || start.getUTCFullYear() !== end.getUTCFullYear() ? ` ${end.getUTCFullYear()}` : '';
  return `Week ${weekNumber(weekStart)} · ${startLabel}–${shortDay.format(end)} ${shortMonth.format(end)}${year}`;
}
export function partner(week: BrakkevaktWeek, userId: string) { return week.assignments.find(a => a.user.id !== userId)?.user; }
export function ownAssignment(week: BrakkevaktWeek, userId: string) { return week.assignments.find(a => a.user.id === userId); }
