import { useEffect, useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { OnboardingRequiredError } from '../api';
import { cacheAgeLabel } from '../cache-age';
import { addDays, osloDate } from '../dates';
import { loadFlyvask } from '../features/flyvask/api';
import { dateLabel, flyvaskSections, participantLabel, timeLabel } from '../features/flyvask/presentation';
import type { FlyvaskData } from '../features/flyvask/types';
import { ShiftList } from '../features/flyvask/ShiftList';
import { FlyvaskExchanges, ExchangeShiftActions } from '../features/flyvask/FlyvaskExchanges';
import { ExchangeV2Provider, ExchangeV2Summary } from '../features/exchange/ExchangeV2';
import { AttentionDetail } from '../app/AttentionDetail';
import { BackLink, PageHeader, RefreshControl } from '../app/controls';
import '../features/duty-ops/duty-ops.css';
import '../features/flyvask/flyvask.css';

export function FlyvaskPage({ view = 'schedule' }: { view?: 'schedule' | 'exchanges' }) {
  const { refresh, user } = useCurrentUser();
  const [data, setData] = useState<FlyvaskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now);
  const today = osloDate(new Date(now));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    loadFlyvask(controller.signal).then(result => {
      if (!controller.signal.aborted) { setData(result); setNow(Date.now()); }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof OnboardingRequiredError) { void refresh().catch(() => {}); return; }
      setError(cause instanceof Error ? cause.message : 'Flyvask could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload, today, refresh, user?.subject]);
  const sections = data ? flyvaskSections(data.shifts, now) : null;
  const center = view === 'exchanges';
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = addDays(today, -((weekday + 6) % 7));
  const nextWeek = addDays(weekStart, 7);
  const thisWeek = data?.shifts.filter(shift => {
    const day = osloDate(new Date(shift.startsAt));
    return day >= weekStart && day < nextWeek;
  }) ?? [];
  const assignments = data?.shifts.map(shift => ({ id: shift.id,
    label: `${dateLabel(shift.startsAt)} · ${timeLabel(shift)}`,
    ownerNames: participantLabel(shift), own: shift.participants.some(person => person.isCurrentUser) })) ?? [];
  return <section className="duty-ops">
    {center && <BackLink to="/flyvask">Flyvask</BackLink>}
    <PageHeader title={center ? 'Exchanges' : 'Flyvask'}><RefreshControl label="Flyvask" onRefresh={() => setReload(n => n + 1)} loading={loading} retry={!!error || !!data?.sync.stale} updatedAt={data?.sync.assignments.lastSyncedAt} now={now} /></PageHeader>
    {data && <div className="duty-meta"><details><summary>Sync details</summary><span>Times in Europe/Oslo · Schedule: {cacheAgeLabel(data.sync.discovery.lastSyncedAt, now)} · Assignments: {cacheAgeLabel(data.sync.assignments.lastSyncedAt, now)}</span></details></div>}
    {loading && !data && <p className="duty-loading" role="status">Loading Flyvask…</p>}
    {error && <p className="duty-alert" role="alert">{error}</p>}
    {data?.sync.stale && <div role="status"><AttentionDetail label="Schedule may be out of date"><p>{data.sync.warning || 'Showing previously synchronized data. Reload to check for updates.'}</p></AttentionDetail></div>}
    {sections && data && <ExchangeV2Provider domain="FLYVASK" assignments={assignments} refreshKey={reload} onChanged={() => setReload(n => n + 1)}>
      <FlyvaskExchanges shifts={data.shifts} now={now} refreshKey={reload} onChanged={() => setReload(n => n + 1)} showBoard={center} legacyOnly>
      {!center && <>
        <section className="flyvask-summary" aria-labelledby="flyvask-mine"><h2 id="flyvask-mine">My upcoming</h2>
          {sections.mine.length ? <ShiftList shifts={sections.mine} showDate renderAction={shift => <ExchangeShiftActions shift={shift} />} /> : <p className="duty-empty">No upcoming shifts</p>}
        </section>
        {thisWeek.length > 0 && <section className="flyvask-summary" aria-labelledby="flyvask-this-week"><h2 id="flyvask-this-week">This week</h2>
          <ShiftList shifts={thisWeek} showDate renderAction={shift => <ExchangeShiftActions shift={shift} />} /></section>}
      </>}
      <ExchangeV2Summary domain="FLYVASK" center={center} />
      {!center && <section id="exchange-schedule" className="flyvask-schedule" aria-labelledby="flyvask-schedule"><h2 id="flyvask-schedule">Schedule</h2>
        {sections.schedule.length ? sections.schedule.map(([date, shifts]) => <section key={date}><h3><time dateTime={date}>{dateLabel(shifts[0].startsAt)}{date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : ''}</time></h3><ShiftList shifts={shifts} renderAction={shift => <ExchangeShiftActions shift={shift} />} /></section>) : <p className="duty-empty">Nothing scheduled</p>}
      </section>}
    </FlyvaskExchanges></ExchangeV2Provider>}
  </section>;
}
export function FlyvaskExchangeCenterPage() { return <FlyvaskPage view="exchanges" />; }
