import { osloDate } from '../../dates';
import type { FlyvaskShift } from './types';

const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', weekday: 'short', day: 'numeric', month: 'short' });
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function dateLabel(utc: string) { return day.format(new Date(utc)); }
export function timeLabel(shift: Pick<FlyvaskShift, 'startsAt' | 'endsAt'>) {
  const end = osloDate(new Date(shift.endsAt)) !== osloDate(new Date(shift.startsAt)) ? `${dateLabel(shift.endsAt)} ` : '';
  return `${clock.format(new Date(shift.startsAt))}–${end}${clock.format(new Date(shift.endsAt))}`;
}
export function participantLabel(shift: Pick<FlyvaskShift, 'participants' | 'participantCount'>) {
  const names = shift.participants.map(p => `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || 'Student');
  const remaining = Math.max(0, shift.participantCount - shift.participants.length);
  if (remaining) names.push(`${remaining} ${names.length ? (remaining === 1 ? 'other' : 'others') : (remaining === 1 ? 'student' : 'students')}`);
  return names.join(' · ') || 'No participants recorded';
}
export function flyvaskSections(shifts: FlyvaskShift[], now: number) {
  const today = osloDate(new Date(now));
  const ordered = [...shifts].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
  const todays = ordered.filter(s => osloDate(new Date(s.startsAt)) <= today && osloDate(new Date(Date.parse(s.endsAt) - 1)) >= today);
  const upcoming = ordered.filter(s => Date.parse(s.endsAt) > now);
  const groups = new Map<string, FlyvaskShift[]>();
  for (const s of upcoming) {
    const key = osloDate(new Date(s.startsAt));
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return { today: todays, mine: upcoming.filter(s => s.status !== 'CANCELLED' && s.participants.some(p => p.isCurrentUser)), schedule: [...groups] };
}
