import { useEffect, useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { OnboardingRequiredError } from '../api';
import { cacheAgeLabel, cacheTimeInOslo } from '../cache-age';
import { osloDate } from '../dates';
import { loadDutyOps } from '../features/duty-ops/api';
import { dateLabel, dutySections, participantLabel, timeLabel } from '../features/duty-ops/presentation';
import type { DutyOpsData, DutyShift } from '../features/duty-ops/types';
import '../features/duty-ops/duty-ops.css';

function ShiftList({ shifts, showDate = false }: { shifts: DutyShift[]; showDate?: boolean }) {
  return <ul>{shifts.map(s => <li key={s.id} className={`duty-row ${s.participants.some(p => p.isCurrentUser) ? 'is-mine' : ''} ${s.status === 'CANCELLED' ? 'is-cancelled' : ''}`}>
    <div className="duty-row-top">{showDate && <span className="duty-row-date">{dateLabel(s.startsAt)}</span>}
      <time dateTime={s.startsAt}>{timeLabel(s)}</time>
      {s.participants.some(p => p.isCurrentUser) && <span className="sr-only">Your shift</span>}
      {s.status === 'CANCELLED' && <span className="duty-status">Cancelled</span>}
      {s.status === 'COMPLETED' && <span className="duty-status">Completed</span>}
      {s.status === 'PARTIALLY_COMPLETED' && <span className="duty-status">Partially completed</span>}
    </div><p className="duty-participants">{participantLabel(s)}</p>
  </li>)}</ul>;
}

export function DutyOpsPage() {
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
  return <section className="duty-ops">
    <div className="duty-heading"><h1>Duty Ops</h1><button aria-label="Reload Duty Ops" disabled={loading} onClick={() => setReload(n => n + 1)}>Reload</button></div>
    {data && <div className="duty-meta"><span>Europe/Oslo</span>
      <span>Schedule: <time dateTime={data.sync.discovery.lastSyncedAt} title={cacheTimeInOslo(data.sync.discovery.lastSyncedAt)}>{cacheAgeLabel(data.sync.discovery.lastSyncedAt, now)}</time></span>
      <span>My shifts: <time dateTime={data.sync.assignments.lastSyncedAt} title={cacheTimeInOslo(data.sync.assignments.lastSyncedAt)}>{cacheAgeLabel(data.sync.assignments.lastSyncedAt, now)}</time></span>
    </div>}
    {loading && <p className="duty-loading" role="status">Loading Duty Ops…</p>}
    {error && <p className="duty-alert" role="alert">{error}</p>}
    {data?.sync.stale && <p className="duty-alert" role="status">{data.sync.warning || 'Showing previously synchronized data. Reload to check for updates.'}</p>}
    {sections && <>
      <div className="duty-summary">
        <section aria-labelledby="duty-today"><h2 id="duty-today">Today</h2>{sections.today.length ? <ShiftList shifts={sections.today} /> : <p className="duty-empty">Nothing scheduled</p>}</section>
        <section aria-labelledby="duty-mine"><h2 id="duty-mine">My shifts</h2>{sections.mine.length ? <ShiftList shifts={sections.mine} showDate /> : <p className="duty-empty">No upcoming shifts</p>}</section>
      </div>
      <section aria-labelledby="duty-schedule"><h2 id="duty-schedule">Schedule</h2>
        {sections.schedule.length ? sections.schedule.map(([date, shifts]) => <section key={date}><h3><time dateTime={date}>{dateLabel(shifts[0].startsAt)}{date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : ''}</time></h3><ShiftList shifts={shifts} /></section>) : <p className="duty-empty">Nothing scheduled</p>}
      </section>
    </>}
  </section>;
}
