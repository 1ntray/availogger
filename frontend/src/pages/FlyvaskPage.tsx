import { useEffect, useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { OnboardingRequiredError } from '../api';
import { cacheAgeLabel, cacheTimeInOslo } from '../cache-age';
import { osloDate } from '../dates';
import { loadFlyvask } from '../features/flyvask/api';
import { dateLabel, flyvaskSections } from '../features/flyvask/presentation';
import type { FlyvaskData } from '../features/flyvask/types';
import { ShiftList } from '../features/flyvask/ShiftList';
import { FlyvaskExchanges, ExchangeShiftActions } from '../features/flyvask/FlyvaskExchanges';
import { FlyvaskNavigation } from '../features/flyvask/FlyvaskNavigation';
import '../features/duty-ops/duty-ops.css';
import '../features/flyvask/flyvask.css';

export function FlyvaskPage() {
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
  return <section className="duty-ops">
    <div className="duty-heading"><h1>Flyvask</h1><button aria-label="Reload Flyvask" disabled={loading} onClick={() => setReload(n => n + 1)}>Reload</button></div>
    <FlyvaskNavigation />
    {data && <div className="duty-meta"><span>Europe/Oslo</span>
      <span>FlightLogger schedule: <time dateTime={data.sync.discovery.lastSyncedAt} title={cacheTimeInOslo(data.sync.discovery.lastSyncedAt)}>{cacheAgeLabel(data.sync.discovery.lastSyncedAt, now)}</time></span>
      <span>FlightLogger assignments: <time dateTime={data.sync.assignments.lastSyncedAt} title={cacheTimeInOslo(data.sync.assignments.lastSyncedAt)}>{cacheAgeLabel(data.sync.assignments.lastSyncedAt, now)}</time></span>
    </div>}
    {loading && <p className="duty-loading" role="status">Loading Flyvask…</p>}
    {error && <p className="duty-alert" role="alert">{error}</p>}
    {data?.sync.stale && <p className="duty-alert" role="status">{data.sync.warning || 'Showing previously synchronized data. Reload to check for updates.'}</p>}
    {sections && data && <FlyvaskExchanges shifts={data.shifts} now={now} refreshKey={reload} onChanged={() => setReload(n => n + 1)}>
      <section aria-labelledby="flyvask-mine"><h2 id="flyvask-mine">My Flyvask</h2>{sections.mine.length ? <ShiftList shifts={sections.mine} showDate renderAction={shift => <ExchangeShiftActions shift={shift} />} /> : <p className="duty-empty">No upcoming Flyvask</p>}</section>
      <section className="flyvask-schedule" aria-labelledby="flyvask-schedule"><h2 id="flyvask-schedule">Schedule</h2>
        {sections.schedule.length ? sections.schedule.map(([date, shifts]) => <section key={date}><h3><time dateTime={date}>{dateLabel(shifts[0].startsAt)}{date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : ''}</time></h3><ShiftList shifts={shifts} /></section>) : <p className="duty-empty">Nothing scheduled</p>}
      </section>
    </FlyvaskExchanges>}
  </section>;
}
