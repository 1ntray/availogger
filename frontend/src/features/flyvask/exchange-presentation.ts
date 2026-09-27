import type { ExchangeShift, ExchangeUser } from '../../../../shared/flyvask-swaps';
import { dateLabel, timeLabel } from './presentation';
export const userName = (user: ExchangeUser) => `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Student';
export const shiftLabel = (shift: ExchangeShift) => `${dateLabel(shift.startsAt)} · ${timeLabel(shift)}`;
const historyDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const historyShiftLabel = (shift: ExchangeShift) => `${historyDate.format(new Date(shift.startsAt))} · ${timeLabel(shift)}`;
export const acceptedLabel = (utc: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Oslo', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(utc));
