import { osloDate } from '../../dates';
import type { DutyShift } from './types';

const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', weekday: 'short', day: 'numeric', month: 'short' });
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function dateLabel(utc: string) { return day.format(new Date(utc)); }
export function timeLabel(shift: Pick<DutyShift, 'startsAt' | 'endsAt'>) {
  const end = osloDate(new Date(shift.endsAt)) !== osloDate(new Date(shift.startsAt)) ? `${dateLabel(shift.endsAt)} ` : '';
  return `${clock.format(new Date(shift.startsAt))}–${end}${clock.format(new Date(shift.endsAt))}`;
}
export function participantLabel(shift: Pick<DutyShift, 'participants' | 'participantCount'>) {
  if (shift.participants.length > shift.participantCount) return `${shift.participantCount} ${shift.participantCount === 1 ? 'student' : 'students'}`;
  const names = shift.participants.map(p => `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'Student');
  const remaining = Math.max(0, shift.participantCount - shift.participants.length);
  if (remaining) names.push(`${remaining} ${names.length ? (remaining === 1 ? 'other' : 'others') : (remaining === 1 ? 'student' : 'students')}`);
  return names.join(' · ') || 'No participants recorded';
}
export const isOwnShift = (shift: DutyShift) => shift.isCurrentUserAssigned ?? shift.participants.some(person => person.isCurrentUser);
export function dutySections(shifts: DutyShift[], now: number) {
  const ordered = [...shifts].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  const upcoming = ordered.filter(s => Date.parse(s.endsAt) > now && s.status !== 'CANCELLED' && s.status !== 'COMPLETED');
  const onDutyNow = upcoming.filter(s => Date.parse(s.startsAt) <= now);
  const groups = new Map<string, DutyShift[]>();
  for (const s of upcoming.filter(shift => Date.parse(shift.startsAt) > now || !isOwnShift(shift))) {
    const key = osloDate(new Date(s.startsAt));
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return { onDutyNow, mine: upcoming.filter(s => Date.parse(s.startsAt) > now && isOwnShift(s)), schedule: [...groups] };
}
