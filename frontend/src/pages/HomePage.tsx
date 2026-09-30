import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ContextLink } from '../app/controls';
import { Icon } from '../app/Icon';
import { Card, CardLink, Chip, DateBlock, EmptyState, Skeleton } from '../app/ui';
import { useCurrentUser } from '../app/CurrentUser';
import { PERMISSIONS, type PermissionKey } from '../../../shared/authorization';
import { displayName } from '../../../shared/display-name';
import { loadFlights, type FlightsData } from '../features/flights/api';
import { loadDutyOps } from '../features/duty-ops/api';
import type { DutyOpsData } from '../features/duty-ops/types';
import { loadFlyvask } from '../features/flyvask/api';
import type { FlyvaskData } from '../features/flyvask/types';
import { loadSchedule } from '../features/brakkevakt/api';
import { ownAssignment, partner, personName, weekLabel, weekNumber } from '../features/brakkevakt/presentation';
import type { BrakkevaktSchedule } from '../../../shared/brakkevakt';
import { contactApi } from '../features/contact/api';
import {
  clock, dayLabel, durationLabel, greeting, homeItems, itemMeta, longDate, peopleLabel, shortDate, startsLabel, syncState,
  timeRange, weekDays, weekStart, withinUpcoming, type HomeItem,
} from './home-model';

type Key = 'flights' | 'duty' | 'flyvask' | 'brakkevakt' | 'inbox';
type Inbox = { unreadCount: number; newest: string | null };
type Data = { flights: FlightsData | null; duty: DutyOpsData | null; flyvask: FlyvaskData | null; brakkevakt: BrakkevaktSchedule | null; inbox: Inbox | null };
const empty: Data = { flights: null, duty: null, flyvask: null, brakkevakt: null, inbox: null };
const moduleNames: Record<Key, string> = { flights: 'Flights', duty: 'Duty Ops', flyvask: 'Flyvask', brakkevakt: 'Brakkevakt', inbox: 'Inbox' };
const exchangePath = { duty: { path: '/duty-ops/exchanges', permission: PERMISSIONS.dutyOpsSwap }, flyvask: { path: '/flyvask/exchanges', permission: PERMISSIONS.flyvaskSwap } } as const;
const UPCOMING_ROWS = 6;

export function HomePage() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<Data>(empty);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const permissions = user?.permissions.join(',') ?? '';
  const can = (permission: PermissionKey) => user?.permissions.includes(permission) === true;
  const loadedFor = useRef('');
  useEffect(() => {
    const controller = new AbortController();
    // A manual refresh keeps the current cards; a different user or permission set starts from empty.
    const identity = `${user?.subject ?? ''}|${permissions}`;
    if (loadedFor.current !== identity) { setData(empty); loadedFor.current = identity; }
    setErrors({}); setLoading(true);
    const jobs: { key: Key; task: Promise<unknown> }[] = [];
    if (can(PERMISSIONS.flightsView)) jobs.push({ key: 'flights', task: loadFlights(controller.signal) });
    if (can(PERMISSIONS.dutyOpsView)) jobs.push({ key: 'duty', task: loadDutyOps(controller.signal) });
    if (can(PERMISSIONS.flyvaskView)) jobs.push({ key: 'flyvask', task: loadFlyvask(controller.signal) });
    if (can(PERMISSIONS.brakkevaktView)) jobs.push({ key: 'brakkevakt', task: loadSchedule(controller.signal) });
    if (user) jobs.push({ key: 'inbox', task: contactApi.inbox(undefined, controller.signal)
      .then(inbox => ({ unreadCount: inbox.unreadCount, newest: inbox.items.find(item => !item.readAt)?.title ?? null })) });
    let pending = jobs.length;
    if (!pending) setLoading(false);
    jobs.forEach(job => {
      void job.task.then(value => {
        if (!controller.signal.aborted) setData(previous => ({ ...previous, [job.key]: value }));
      }).catch(() => {
        // The Inbox card degrades to its link; only schedule modules are reported as unavailable.
        if (!controller.signal.aborted && job.key !== 'inbox') setErrors(previous => ({ ...previous, [job.key]: `${moduleNames[job.key]} unavailable` }));
      }).finally(() => {
        pending--;
        if (!controller.signal.aborted && pending === 0) setLoading(false);
      });
    });
    return () => controller.abort();
  }, [user?.subject, permissions, reload]);

  const items = homeItems(data, now);
  const next = items[0] ?? null;
  const upcoming = withinUpcoming(items, now).slice(0, UPCOMING_ROWS);
  const days = weekDays(items, now);
  const sync = syncState(data);
  const firstLoad = loading && !items.length;
  const syncText = sync.at === null ? null : `Synced ${clock.format(new Date(sync.at))}`;
  const schedule = data.brakkevakt;
  const currentWeek = schedule?.weeks.find(week => week.weekStart === schedule.currentWeekStart);
  const nextOwnWeek = schedule?.weeks.filter(week => ownAssignment(week, schedule.currentUserId) && week.weekStart >= schedule.currentWeekStart)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))[0];
  const nextOwnPartner = nextOwnWeek && schedule ? partner(nextOwnWeek, schedule.currentUserId) : null;
  const ownThisWeek = !!(currentWeek && schedule && ownAssignment(currentWeek, schedule.currentUserId));
  const fuelAttention = (data.flights?.flights ?? []).filter(flight => flight.request?.status === 'NEEDS_REVIEW' && Date.parse(flight.endsAt) > now);
  const staleSources = (['flights', 'duty', 'flyvask'] as const).filter(key => data[key]?.sync.stale)
    .map(key => ({ key, label: `${moduleNames[key]} may be out of date`, path: key === 'duty' ? '/duty-ops' : `/${key}` }));
  const unread = data.inbox?.unreadCount ?? 0;
  const attention = unread > 0 || fuelAttention.length > 0 || staleSources.length > 0;
  const upcomingFlights = items.filter(item => item.kind === 'flight').slice(0, 2);
  const name = user?.firstName?.trim() || (user ? displayName(user) : '');

  return <section className="home-page">
    <header className="home-greeting">
      <div>
        <h1>{greeting(now)}{name ? `, ${name}` : ''}</h1>
        <p className="home-subline">
          <span className="home-date-long">{longDate(now)}</span><span className="home-date-short">{shortDate(now, now)}</span>
          {' · '}Week {weekNumber(weekStart(now))}
          <span className="home-sync-inline">{firstLoad ? <Skeleton width={72} height={12} /> : sync.stale ? <> · <Chip tone="warning">May be out of date</Chip></> : syncText && ` · ${syncText}`}</span>
        </p>
      </div>
      <button type="button" className="ui-button ui-button--ghost home-sync-button" onClick={() => setReload(value => value + 1)} disabled={loading}
        aria-label={`Refresh${syncText ? ` · ${syncText}` : ''}`}>
        <Icon name="reload" size={16} />{sync.stale ? 'May be out of date' : syncText ?? 'Refresh'}
      </button>
    </header>

    {!firstLoad && (attention
      ? <nav className="home-attention" aria-label="Needs attention">
        {unread > 0 && <Link className="chip chip--warning" to="/inbox">{unread} unread in Inbox</Link>}
        {fuelAttention.map(flight => <Link key={flight.id} className="chip chip--warning" to="/flights">Fuel needs review · {flight.aircraft?.callSign ?? shortDate(Date.parse(flight.startsAt), now)}</Link>)}
        {staleSources.map(source => <Link key={source.key} className="chip chip--warning" to={source.path}>{source.label}</Link>)}
      </nav>
      : <p className="home-all-clear"><Icon name="check-circle" size={16} />Nothing is waiting on you. No unread messages{can(PERMISSIONS.flightsView) ? ' or fuel reviews' : ''}.</p>)}

    <div className="home-grid">
      <div className="home-main">
        <Card className="home-week-card" title="This week" titleId="home-week-title" aside={<span className="card-aside">Week {weekNumber(weekStart(now))}</span>}>
          <ol className="home-week-days">{days.map(day => {
            const label = <><span>{day.weekday}</span><strong>{day.day}</strong><i className={day.first ? 'has-item' : ''} /></>;
            const attrs = { className: `home-week-day${day.today ? ' is-today' : ''}`, 'aria-current': day.today ? 'date' as const : undefined,
              'aria-label': `${day.weekday} ${day.day}${day.first ? `, ${day.first.title} ${timeRange(day.first)}` : ''}` };
            return <li key={day.date}>{day.first ? <ContextLink to={day.first.path} {...attrs}>{label}</ContextLink> : <span {...attrs}>{label}</span>}</li>;
          })}</ol>
          {currentWeek && schedule && <div className="home-week-bar"><Icon name="calendar" size={16} />
            <span>{ownThisWeek ? `Brakkevakt all week${nextOwnPartner ? ` · with ${personName(nextOwnPartner)}` : ''}`
              : `Brakkevakt this week · ${currentWeek.assignments.map(assignment => personName(assignment.user)).join(' · ')}`}</span>
            <CardLink to="/brakkevakt">Schedule</CardLink></div>}
        </Card>

        <Card className="home-next" label="Up next">
          {firstLoad ? <UpNextSkeleton /> : next ? <UpNext item={next} now={now} can={can} /> :
            <EmptyState icon="calendar" title="Nothing scheduled" body="Your next shift or flight will show up here." />}
        </Card>

        <Card className="home-upcoming" title="Upcoming" titleId="home-upcoming-title"
          aside={<span className="card-aside-group"><span className="card-aside">Next 30 days</span>{can(PERMISSIONS.dutyOpsView) && <span className="home-desktop-only"><CardLink to="/duty-ops">All shifts</CardLink></span>}</span>}>
          {firstLoad ? <ul className="home-rows">{[0, 1, 2].map(index => <li key={index} className="home-row home-row--skeleton"><Skeleton width={44} height={44} /><span><Skeleton width="45%" /><Skeleton width="75%" height={12} /></span></li>)}</ul>
            : upcoming.length ? <ul className="home-rows">{upcoming.map(item => <li key={item.id}>
              <ContextLink className="home-row" to={item.path}><DateBlock at={item.at} />
                <span className="home-row-text"><strong>{item.title}</strong><span>{itemMeta(item)}</span></span>
                <span className="home-desktop-only"><Chip tone="soft">{item.kind === 'flight' ? 'Your flight' : 'Your shift'}</Chip></span>
                <Icon name="chevron-right" size={18} /></ContextLink></li>)}</ul>
            : <EmptyState icon="calendar" title="Nothing in the next 30 days" body="Open a module to pick up a shift." />}
        </Card>
      </div>

      <div className="home-side">
        {can(PERMISSIONS.brakkevaktView) && <Card title="Brakkevakt" titleId="home-brakkevakt-title"
          aside={can(PERMISSIONS.brakkevaktManageSchedule) ? <CardLink to="/brakkevakt/manage">Manage schedule</CardLink> : <CardLink to="/brakkevakt">Open</CardLink>}>
          {nextOwnWeek ? <Link className="home-tile-row" to="/brakkevakt"><span className="icon-tile icon-tile--soft"><Icon name="calendar" size={20} /></span>
            <span className="empty-state-text"><strong>Week {weekNumber(nextOwnWeek.weekStart)}{nextOwnWeek.weekStart === schedule?.currentWeekStart ? ' · this week' : ''}</strong>
              <span>{weekLabel(nextOwnWeek.weekStart)}{nextOwnPartner ? ` · with ${personName(nextOwnPartner)}` : ''}</span></span></Link>
            : firstLoad ? <Skeleton height={40} /> : <EmptyState icon="calendar" title="No Brakkevakt week assigned" body="Your next week shows up here." />}
        </Card>}
        {can(PERMISSIONS.flightsView) && <Card title="Flights" titleId="home-flights-title" aside={<CardLink to="/flights">Open</CardLink>}>
          {upcomingFlights.length ? <ul className="home-rows home-rows--compact">{upcomingFlights.map(item => <li key={item.id}>
            <ContextLink className="home-row" to={item.path}><DateBlock at={item.at} /><span className="home-row-text"><strong>{dayLabel(item.at, now)}</strong><span>{itemMeta(item)}</span></span></ContextLink></li>)}</ul>
            : firstLoad ? <Skeleton height={40} /> : <EmptyState icon="flights" title="No flights in the next 4 weeks"
              body={data.flights ? `Synced ${clock.format(new Date(data.flights.sync.lastSyncedAt))} from FlightLogger` : undefined} />}
        </Card>}
        <Card title="Inbox" titleId="home-inbox-title" aside={<CardLink to="/inbox">Open</CardLink>}>
          {unread > 0 ? <Link className="home-tile-row" to="/inbox"><span className="icon-tile icon-tile--soft"><Icon name="inbox" size={20} /></span>
            <span className="empty-state-text"><strong>{unread} unread</strong>{data.inbox?.newest && <span>{data.inbox.newest}</span>}</span></Link>
            : <EmptyState icon="inbox" title="You're all caught up" body="Exchange requests and notices show up here" />}
        </Card>
      </div>
    </div>
    {Object.keys(errors).length > 0 && <p role="status" className="home-errors">{Object.values(errors).join(' · ')}. Open a module to retry.</p>}
  </section>;
}

function UpNext({ item, now, can }: { item: HomeItem; now: number; can: (permission: PermissionKey) => boolean }) {
  const starts = startsLabel(item, now);
  const exchange = item.kind === 'flight' ? null : exchangePath[item.kind];
  return <>
    <div className="home-next-top"><span className="home-eyebrow">Up next · {dayLabel(item.at, now)}</span><Chip tone={starts.tone}>{starts.text}</Chip></div>
    <div className="home-next-title"><h2>{item.title}</h2><Chip tone="soft">{item.kind === 'flight' ? 'Your flight' : 'Your shift'}</Chip></div>
    <ul className="home-next-meta">
      <li><Icon name="calendar" size={16} />{shortDate(item.at, now)}</li>
      <li><Icon name="clock" size={16} />{timeRange(item)} · {durationLabel(item.at, item.end)}</li>
      {item.place && <li><Icon name="pin" size={16} />{item.place}</li>}
      {item.others !== null && <li><Icon name="users" size={16} />{peopleLabel(item.others)}</li>}
      {item.kind === 'flight' && item.flightDetail && <li><Icon name="flights" size={16} />{item.flightDetail.split(' · ').slice(1).join(' · ')}</li>}
    </ul>
    <div className="home-next-actions">
      <ContextLink className="ui-button ui-button--primary" to={item.path}>{item.kind === 'flight' ? 'Open flight' : 'Open shift'}<Icon name="arrow-right" size={16} /></ContextLink>
      {exchange && can(exchange.permission) && <ContextLink className="ui-button" to={exchange.path}><Icon name="swap" size={16} />Exchange</ContextLink>}
    </div>
  </>;
}

function UpNextSkeleton() {
  return <div className="home-next-skeleton" role="status" aria-label="Loading schedule">
    <Skeleton width="40%" height={12} /><Skeleton width="55%" height={26} /><Skeleton width="80%" /><Skeleton width="60%" />
    <span className="home-next-actions"><Skeleton width={128} height={40} /><Skeleton width={112} height={40} /></span>
  </div>;
}
