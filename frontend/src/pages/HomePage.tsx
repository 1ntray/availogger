import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { osloDate } from '../dates';
import { useCurrentUser } from '../app/CurrentUser';
import { PERMISSIONS } from '../../../shared/authorization';
import { loadFlights, type FlightsData } from '../features/flights/api';
import { loadDutyOps } from '../features/duty-ops/api';
import { participantLabel, timeLabel as dutyTime } from '../features/duty-ops/presentation';
import type { DutyOpsData } from '../features/duty-ops/types';
import { loadFlyvask } from '../features/flyvask/api';
import type { FlyvaskData } from '../features/flyvask/types';
import { loadSchedule } from '../features/brakkevakt/api';
import { compactWeekTitle, ownAssignment, partner, personName } from '../features/brakkevakt/presentation';
import type { BrakkevaktSchedule } from '../../../shared/brakkevakt';

type Key = 'flights' | 'duty' | 'flyvask' | 'brakkevakt';
type Data = { flights: FlightsData | null; duty: DutyOpsData | null; flyvask: FlyvaskData | null; brakkevakt: BrakkevaktSchedule | null };
type Item = { id: string; at: number; title: string; detail: string; path: string; context?: string };
const empty: Data = { flights: null, duty: null, flyvask: null, brakkevakt: null };
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', weekday: 'short', day: 'numeric', month: 'short' });
const dayName = (at: number, today: string) => {
  const date = osloDate(new Date(at));
  const tomorrow = osloDate(new Date(Date.parse(`${today}T12:00:00Z`) + 86400000));
  return date === today ? 'Today' : date === tomorrow ? 'Tomorrow' : day.format(new Date(at));
};
export function HomePage() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<Data>(empty);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const permissions = user?.permissions.join(',') ?? '';
  useEffect(() => {
    const controller = new AbortController();
    setData(empty); setErrors({}); setLoading(true);
    const permitted = (permission: string) => user?.permissions.includes(permission as typeof PERMISSIONS[keyof typeof PERMISSIONS]) === true;
    const jobs: { key: Key; task: Promise<unknown> }[] = [];
    if (permitted(PERMISSIONS.flightsView)) jobs.push({ key: 'flights', task: loadFlights(controller.signal) });
    if (permitted(PERMISSIONS.dutyOpsView)) jobs.push({ key: 'duty', task: loadDutyOps(controller.signal) });
    if (permitted(PERMISSIONS.flyvaskView)) jobs.push({ key: 'flyvask', task: loadFlyvask(controller.signal) });
    if (permitted(PERMISSIONS.brakkevaktView)) jobs.push({ key: 'brakkevakt', task: loadSchedule(controller.signal) });
    let pending = jobs.length;
    if (!pending) setLoading(false);
    jobs.forEach(job => {
      void job.task.then(value => {
        if (!controller.signal.aborted) setData(previous => ({ ...previous, [job.key]: value }));
      }).catch(() => {
        if (!controller.signal.aborted) setErrors(previous => ({ ...previous, [job.key]: `${job.key === 'duty' ? 'Duty Ops' : job.key === 'flyvask' ? 'Flyvask' : job.key === 'brakkevakt' ? 'Brakkevakt' : 'Flights'} unavailable` }));
      }).finally(() => {
        pending--;
        if (!controller.signal.aborted && pending === 0) setLoading(false);
      });
    });
    return () => controller.abort();
  }, [user?.subject, permissions]);
  const today = osloDate(new Date(now));
  const dateLabel = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' }).format(new Date(now));
  const items: Item[] = [];
  for (const flight of data.flights?.flights ?? []) {
    if (flight.status === 'CANCELLED' || Date.parse(flight.endsAt) <= now) continue;
    const cover = data.duty?.shifts.find(shift => shift.status !== 'CANCELLED' && Date.parse(shift.startsAt) <= Date.parse(flight.startsAt) && Date.parse(shift.endsAt) > Date.parse(flight.startsAt));
    items.push({ id: `flight:${flight.id}`, at: Date.parse(flight.startsAt), title: 'Flight',
      detail: `${clock.format(new Date(flight.startsAt))} · ${flight.aircraft?.callSign ?? 'Aircraft pending'} · ${flight.departureAirport?.name ?? 'Departure pending'} → ${flight.arrivalAirport?.name ?? 'Arrival pending'}`, path: '/flights',
      context: cover ? `Duty Ops: ${participantLabel(cover)} · ${dutyTime(cover)}` : undefined });
  }
  for (const shift of data.duty?.shifts ?? []) {
    if (shift.status === 'CANCELLED' || shift.status === 'COMPLETED' || Date.parse(shift.endsAt) <= now || !shift.participants.some(person => person.isCurrentUser)) continue;
    items.push({ id: `duty:${shift.id}`, at: Date.parse(shift.startsAt), title: 'Duty Ops', detail: dutyTime(shift), path: `/duty-ops/shifts/${encodeURIComponent(shift.id)}` });
  }
  for (const shift of data.flyvask?.shifts ?? []) {
    if (shift.status === 'CANCELLED' || shift.status === 'COMPLETED' || Date.parse(shift.endsAt) <= now || Date.parse(shift.startsAt) > now + 48 * 3600000 || !shift.participants.some(person => person.isCurrentUser)) continue;
    items.push({ id: `flyvask:${shift.id}`, at: Date.parse(shift.startsAt), title: 'Flyvask', detail: clock.format(new Date(shift.startsAt)), path: '/flyvask' });
  }
  items.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const fuelAttention = (data.flights?.flights ?? []).filter(flight => flight.request?.status === 'NEEDS_REVIEW' && Date.parse(flight.endsAt) > now);
  const staleSources = [
    data.flights?.sync.stale && { id: 'flights', label: 'Flights may be out of date', path: '/flights' },
    data.duty?.sync.stale && { id: 'duty', label: 'Duty Ops may be out of date', path: '/duty-ops' },
    data.flyvask?.sync.stale && { id: 'flyvask', label: 'Flyvask may be out of date', path: '/flyvask' },
  ].filter((source): source is { id: string; label: string; path: string } => !!source);
  const currentWeek = data.brakkevakt?.weeks.find(week => week.weekStart === data.brakkevakt?.currentWeekStart);
  const nextOwnWeek = data.brakkevakt?.weeks.filter(week => ownAssignment(week, data.brakkevakt!.currentUserId) && week.weekStart >= data.brakkevakt!.currentWeekStart)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))[0];
  const nextOwnPartner = nextOwnWeek && data.brakkevakt ? partner(nextOwnWeek, data.brakkevakt.currentUserId) : null;
  const grouped = new Map<string, Item[]>();
  const tomorrow = osloDate(new Date(Date.parse(`${today}T12:00:00Z`) + 86400000));
  const nearEnd = osloDate(new Date(Date.parse(`${today}T12:00:00Z`) + 3 * 86400000));
  items.forEach(item => { const date = osloDate(new Date(item.at)); const label = date === today ? 'Today' : date === tomorrow ? 'Tomorrow' : date <= nearEnd ? dayName(item.at, today) : 'Upcoming'; const rows = grouped.get(label) ?? []; if (label !== 'Upcoming' || rows.length < 8) grouped.set(label, [...rows, item]); });
  return <section className="home-page">
    <header className="home-heading"><h1>Home</h1><time className="today-date" dateTime={today}>{dateLabel}</time></header>
    <div className="home-layout"><section className="home-schedule"><h2>My schedule</h2>
      {loading && !items.length && !currentWeek && <p role="status">Loading schedule…</p>}
      {!loading && !items.length && !nextOwnWeek && <p className="home-muted">Nothing upcoming</p>}
      {[...grouped].map(([label, rows]) => <div className="home-day" key={label}><h3>{label}</h3><ul>{rows.map(item => <li key={item.id}><Link to={item.path}><strong>{item.title}</strong><span>{item.detail}</span><span aria-hidden="true">→</span></Link>{item.context && <p className="home-item-context">{item.context}</p>}</li>)}</ul></div>)}
      {nextOwnWeek && <div className="home-day home-week"><h3>{nextOwnWeek.weekStart === data.brakkevakt?.currentWeekStart ? 'This week' : compactWeekTitle(nextOwnWeek.weekStart)}</h3><ul><li><Link to="/brakkevakt"><strong>Brakkevakt</strong><span>{nextOwnPartner ? `With ${personName(nextOwnPartner)} · ` : ''}{compactWeekTitle(nextOwnWeek.weekStart)}</span><span aria-hidden="true">→</span></Link></li></ul></div>}
    </section>
    <div className="home-context">
      {(fuelAttention.length > 0 || staleSources.length > 0) && <section><h2>Needs attention</h2><ul>{fuelAttention.map(flight => <li key={flight.id}><Link to="/flights">Fuel needs review · {flight.aircraft?.callSign ?? day.format(new Date(flight.startsAt))} →</Link></li>)}{staleSources.map(source => <li key={source.id}><Link to={source.path}>{source.label} →</Link></li>)}</ul></section>}
      {currentWeek && !ownAssignment(currentWeek, data.brakkevakt!.currentUserId) && <section><h2>Brakkevakt this week</h2><p>{currentWeek.assignments.map(assignment => personName(assignment.user)).join(' · ')}</p></section>}
      {Object.keys(errors).length > 0 && <p role="status" className="home-muted">{Object.values(errors).join(' · ')}. Open a module to retry.</p>}
    </div></div>
  </section>;
}
