import { useEffect, useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { OnboardingRequiredError } from '../api';
import { cacheAgeLabel } from '../cache-age';
import { osloDate } from '../dates';
import { loadDutyOps } from '../features/duty-ops/api';
import { dateLabel, dutySections } from '../features/duty-ops/presentation';
import type { DutyOpsData } from '../features/duty-ops/types';
import { ShiftList } from '../features/duty-ops/ShiftList';
import { DutyExchanges, ExchangeShiftActions } from '../features/duty-ops/DutyExchanges';
import { AttentionDetail } from '../app/AttentionDetail';
import { BackLink, PageHeader, RefreshControl } from '../app/controls';
import '../features/duty-ops/duty-ops.css';
import '../features/duty-ops/credits.css';

export function DutyOpsPage({ view = 'schedule' }: { view?: 'schedule' | 'exchanges' }) {
  const { refresh } = useCurrentUser();
  const [data, setData] = useState<DutyOpsData | null>(null);
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
    const controller = new AbortController();
    setLoading(true); setError('');
    loadDutyOps(controller.signal).then(result => {
      if (!controller.signal.aborted) { setData(result); setNow(Date.now()); }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof OnboardingRequiredError) { void refresh().catch(() => {}); return; }
      setError(cause instanceof Error ? cause.message : 'Duty Ops could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload, today, refresh]);
  const sections = data ? dutySections(data.shifts, now) : null;
  const center = view === 'exchanges';
  return <section className="duty-ops">
    {center && <BackLink to="/duty-ops">Duty Ops</BackLink>}
    <PageHeader title={center ? 'Exchanges' : 'Duty Ops'}><RefreshControl label="Duty Ops" onRefresh={() => setReload(n => n + 1)} loading={loading} retry={!!error || !!data?.sync.stale} updatedAt={data?.sync.assignments.lastSyncedAt} now={now} /></PageHeader>
    {data && <div className="duty-meta"><details><summary>Sync details</summary><span>Times in Europe/Oslo · Schedule: {cacheAgeLabel(data.sync.discovery.lastSyncedAt, now)} · Assignments: {cacheAgeLabel(data.sync.assignments.lastSyncedAt, now)}</span></details></div>}
    {loading && !data && <p className="duty-loading" role="status">Loading Duty Ops…</p>}
    {error && <p className="duty-alert" role="alert">{error}</p>}
    {data?.sync.stale && <div role="status"><AttentionDetail label="Schedule may be out of date"><p>{data.sync.warning || 'Showing previously synchronized data. Reload to check for updates.'}</p></AttentionDetail></div>}
    {sections && data && <DutyExchanges shifts={data.shifts} now={now} refreshKey={reload} onChanged={() => setReload(n => n + 1)} showBoard={center} showOverview={!center} afterBoard={!center && sections.schedule.length > 0 &&
      <section className="duty-schedule" aria-labelledby="duty-schedule"><h2 id="duty-schedule">Upcoming schedule</h2>
        {sections.schedule.map(([date, shifts]) => <section key={date}><h3><time dateTime={date}>{dateLabel(shifts[0].startsAt)}{date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : ''}</time></h3><ShiftList shifts={shifts} linkToShift renderAction={shift => <ExchangeShiftActions shift={shift} />} /></section>)}
      </section>}>
      {!center && <div className="duty-summary">
        {(sections.mine.length > 0 || sections.onDutyNow.length === 0) && <section aria-labelledby="duty-mine"><h2 id="duty-mine">My upcoming shifts</h2>{sections.mine.length ? <ShiftList shifts={sections.mine} showDate linkToShift renderAction={shift => <ExchangeShiftActions shift={shift} />} /> : <p className="duty-empty">No upcoming shifts</p>}</section>}
        {sections.onDutyNow.length > 0 && <section aria-labelledby="duty-now"><h2 id="duty-now">On duty now</h2><ShiftList shifts={sections.onDutyNow} linkToShift renderAction={shift => <ExchangeShiftActions shift={shift} />} /></section>}
      </div>}
    </DutyExchanges>}
  </section>;
}
export function DutyExchangeCenterPage() { return <DutyOpsPage view="exchanges" />; }
