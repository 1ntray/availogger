import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PERMISSIONS } from '../../../shared/authorization';
import { creditSign, loadCreditSummary } from '../features/duty-ops/credit-api';
import { useCurrentUser } from '../app/CurrentUser';
import { OnboardingRequiredError } from '../api';
import { cacheAgeLabel, cacheTimeInOslo } from '../cache-age';
import { osloDate } from '../dates';
import { loadDutyOps } from '../features/duty-ops/api';
import { dateLabel, dutySections } from '../features/duty-ops/presentation';
import type { DutyOpsData } from '../features/duty-ops/types';
import { ShiftList } from '../features/duty-ops/ShiftList';
import { DutyExchanges, ExchangeShiftActions } from '../features/duty-ops/DutyExchanges';
import { DutyOpsNavigation } from '../features/duty-ops/DutyOpsNavigation';
import '../features/duty-ops/duty-ops.css';
import '../features/duty-ops/credits.css';

export function DutyOpsPage() {
  const { user, refresh } = useCurrentUser();
  const canSwap = user?.permissions?.includes(PERMISSIONS.dutyOpsSwap) === true;
  const [balance, setBalance] = useState<number | null>(null);
  const [creditUnavailable, setCreditUnavailable] = useState(false);
  const [data, setData] = useState<DutyOpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now);
  const today = osloDate(new Date(now));
  useEffect(() => {
    setBalance(null); setCreditUnavailable(false);
    if (canSwap || !user) return;
    const controller = new AbortController(); let pending = false;
    const update = async () => {
      if (pending) return;
      pending = true;
      try { const result = await loadCreditSummary(controller.signal); if (!controller.signal.aborted) { setBalance(result.balance); setCreditUnavailable(false); } }
      catch { if (!controller.signal.aborted) setCreditUnavailable(true); }
      finally { pending = false; }
    };
    void update();
    const visible = () => { if (!document.hidden) void update(); };
    const timer = window.setInterval(visible, 60_000);
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [canSwap, user?.subject, reload]);
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
    <div className="duty-heading"><h1>Duty Ops</h1><div className="duty-credit-controls"><Link className="credit-link" to="/duty-ops/credits">Credits {balance === null ? creditUnavailable ? 'unavailable' : '…' : creditSign(balance)}</Link><button aria-label="Reload Duty Ops" disabled={loading} onClick={() => setReload(n => n + 1)}>Reload</button></div></div>
    <DutyOpsNavigation />
    {data && <div className="duty-meta"><span>Europe/Oslo</span>
      <span>FlightLogger schedule: <time dateTime={data.sync.discovery.lastSyncedAt} title={cacheTimeInOslo(data.sync.discovery.lastSyncedAt)}>{cacheAgeLabel(data.sync.discovery.lastSyncedAt, now)}</time></span>
      <span>FlightLogger assignments: <time dateTime={data.sync.assignments.lastSyncedAt} title={cacheTimeInOslo(data.sync.assignments.lastSyncedAt)}>{cacheAgeLabel(data.sync.assignments.lastSyncedAt, now)}</time></span>
    </div>}
    {loading && <p className="duty-loading" role="status">Loading Duty Ops…</p>}
    {error && <p className="duty-alert" role="alert">{error}</p>}
    {data?.sync.stale && <p className="duty-alert" role="status">{data.sync.warning || 'Showing previously synchronized data. Reload to check for updates.'}</p>}
    {sections && data && <DutyExchanges shifts={data.shifts} now={now} refreshKey={reload} onChanged={() => setReload(n => n + 1)} onBalanceChanged={setBalance}>
      <div className="duty-summary">
        <section aria-labelledby="duty-today"><h2 id="duty-today">Today</h2>{sections.today.length ? <ShiftList shifts={sections.today} /> : <p className="duty-empty">Nothing scheduled</p>}</section>
        <section aria-labelledby="duty-mine"><h2 id="duty-mine">My shifts</h2>{sections.mine.length ? <ShiftList shifts={sections.mine} showDate renderAction={shift => <ExchangeShiftActions shift={shift} />} /> : <p className="duty-empty">No upcoming shifts</p>}</section>
      </div>
      <section aria-labelledby="duty-schedule"><h2 id="duty-schedule">Schedule</h2>
        {sections.schedule.length ? sections.schedule.map(([date, shifts]) => <section key={date}><h3><time dateTime={date}>{dateLabel(shifts[0].startsAt)}{date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : ''}</time></h3><ShiftList shifts={shifts} /></section>) : <p className="duty-empty">Nothing scheduled</p>}
      </section>
    </DutyExchanges>}
  </section>;
}
