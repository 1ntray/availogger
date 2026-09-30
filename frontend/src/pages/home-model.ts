import { addDays, durationLabel, osloDate } from '../dates';

export { durationLabel };
import type { FlightsData } from '../features/flights/api';
import { flightLessonLabels, flightSegments } from '../features/flights/presentation';
import type { DutyOpsData } from '../features/duty-ops/types';
import type { FlyvaskData } from '../features/flyvask/types';

export type HomeItemKind = 'duty' | 'flyvask' | 'flight';
export type HomeItem = {
  id: string; kind: HomeItemKind; at: number; end: number; title: string; path: string;
  // People besides the current user (duty/flyvask), place (flyvask) and the compact flight detail line.
  others: number | null; place: string | null; flightDetail: string | null;
};
export type HomeSources = { flights: FlightsData | null; duty: DutyOpsData | null; flyvask: FlyvaskData | null };

const HOUR = 3_600_000, DAY = 86_400_000;
export const UPCOMING_DAYS = 30;
const zone = 'Europe/Oslo';
export const clock = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hourOnly = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' });
const shortDay = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' });
const shortDayYear = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const longDay = new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' });
const partsOf = (formatter: Intl.DateTimeFormat, at: number) =>
  formatter.formatToParts(new Date(at)).filter(part => part.type !== 'literal').map(part => part.value).join(' ');

/** "Thu 1 Oct", with the year only when it differs from today's. */
export function shortDate(at: number, now: number) {
  return partsOf(osloDate(new Date(at)).slice(0, 4) === osloDate(new Date(now)).slice(0, 4) ? shortDay : shortDayYear, at);
}
export const longDate = (at: number) => partsOf(longDay, at);

export function greeting(now: number) {
  const hour = Number(hourOnly.format(new Date(now)));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function dayLabel(at: number, now: number) {
  const date = osloDate(new Date(at)), today = osloDate(new Date(now));
  return date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : shortDate(at, now);
}

export function peopleLabel(others: number) {
  return others <= 0 ? 'Only you' : `You + ${others} ${others === 1 ? 'other' : 'others'}`;
}


export const timeRange = (item: Pick<HomeItem, 'at' | 'end'>) => `${clock.format(new Date(item.at))}–${clock.format(new Date(item.end))}`;

/** One line under a row title: time, place and people for shifts; the flight detail for flights. */
export function itemMeta(item: HomeItem) {
  if (item.kind === 'flight') return item.flightDetail ?? timeRange(item);
  return [timeRange(item), item.place, item.others === null ? null : peopleLabel(item.others)].filter(Boolean).join(' · ');
}

export function startsLabel(item: Pick<HomeItem, 'at' | 'end'>, now: number): { text: string; tone: 'soft' | 'warning' } {
  if (item.at <= now) return { text: `In progress · ends ${clock.format(new Date(item.end))}`, tone: 'soft' };
  const minutes = Math.ceil((item.at - now) / 60_000);
  if (minutes < 60) return { text: `Starts in ${minutes} min`, tone: 'warning' };
  if (item.at - now < DAY) return { text: `Starts in ${Math.floor((item.at - now) / HOUR)} h`, tone: 'warning' };
  const days = Math.round((item.at - now) / DAY);
  return { text: `Starts in ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'warning' };
}

const others = (shift: { participantCount: number; participants: { isCurrentUser: boolean }[] }) =>
  Math.max(shift.participantCount, shift.participants.length) - 1;

/** The current user's upcoming commitments across modules, soonest first. */
export function homeItems(sources: HomeSources, now: number): HomeItem[] {
  const items: HomeItem[] = [];
  for (const flight of sources.flights?.flights ?? []) {
    if (flight.status === 'CANCELLED' || Date.parse(flight.endsAt) <= now) continue;
    const segment = flightSegments(flight), lessons = flightLessonLabels(flight);
    const flightTime = segment.flight?.start ? ` · ${clock.format(new Date(segment.flight.start))}${segment.flight.end ? `–${clock.format(new Date(segment.flight.end))}` : ''} Flight` : '';
    const endTime = segment.end?.start ? ` · End ${clock.format(new Date(segment.end.start))}` : '';
    items.push({ id: `flight:${flight.id}`, kind: 'flight', at: Date.parse(flight.startsAt), end: Date.parse(flight.endsAt), title: 'Flight', path: '/flights',
      others: null, place: null,
      flightDetail: `${clock.format(new Date(flight.startsAt))} Brief${flightTime}${endTime} · ${flight.aircraft?.callSign ?? 'Aircraft pending'}${lessons.length ? ` · ${lessons.join(' · ')}` : ''}` });
  }
  for (const shift of sources.duty?.shifts ?? []) {
    if (shift.status === 'CANCELLED' || shift.status === 'COMPLETED' || Date.parse(shift.endsAt) <= now || !shift.participants.some(person => person.isCurrentUser)) continue;
    items.push({ id: `duty:${shift.id}`, kind: 'duty', at: Date.parse(shift.startsAt), end: Date.parse(shift.endsAt), title: 'Duty Ops',
      path: `/duty-ops/shifts/${encodeURIComponent(shift.id)}`, others: others(shift), place: null, flightDetail: null });
  }
  for (const shift of sources.flyvask?.shifts ?? []) {
    if (shift.status === 'CANCELLED' || shift.status === 'COMPLETED' || Date.parse(shift.endsAt) <= now || !shift.participants.some(person => person.isCurrentUser)) continue;
    items.push({ id: `flyvask:${shift.id}`, kind: 'flyvask', at: Date.parse(shift.startsAt), end: Date.parse(shift.endsAt), title: 'Flyvask',
      path: '/flyvask', others: others(shift), place: shift.classroomName, flightDetail: null });
  }
  return items.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export const withinUpcoming = (items: HomeItem[], now: number) => items.filter(item => item.at <= now + UPCOMING_DAYS * DAY);

export type WeekDay = { date: string; weekday: string; day: number; today: boolean; first: HomeItem | null };

/** Monday–Sunday of the Oslo week containing now, each with the first own item starting that day. */
export function weekDays(items: HomeItem[], now: number): WeekDay[] {
  const today = osloDate(new Date(now));
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return names.map((weekday, index) => {
    const date = addDays(monday, index);
    return { date, weekday, day: Number(date.slice(8)), today: date === today, first: items.find(item => osloDate(new Date(item.at)) === date) ?? null };
  });
}
export const weekStart = (now: number) => weekDays([], now)[0].date;

/** Newest successful sync across loaded modules, and whether any of them is stale. */
export function syncState(sources: HomeSources): { at: number | null; stale: boolean } {
  const times = [sources.flights?.sync.lastSyncedAt, sources.duty?.sync.assignments?.lastSyncedAt, sources.flyvask?.sync.assignments?.lastSyncedAt]
    .map(value => value ? Date.parse(value) : NaN).filter(Number.isFinite);
  return { at: times.length ? Math.max(...times) : null,
    stale: !!(sources.flights?.sync.stale || sources.duty?.sync.stale || sources.flyvask?.sync.stale) };
}
