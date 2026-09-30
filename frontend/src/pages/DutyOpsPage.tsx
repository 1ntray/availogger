import { useEffect, useState, type ReactNode } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { OnboardingRequiredError } from '../api';
import { cacheAgeLabel } from '../cache-age';
import { osloDate } from '../dates';
import { loadDutyOps } from '../features/duty-ops/api';
import { dateLabel, dutySections, participantLabel, timeLabel } from '../features/duty-ops/presentation';
import type { DutyOpsData } from '../features/duty-ops/types';
import { DutyExchanges } from '../features/duty-ops/DutyExchanges';
import { DutyOpsSkeleton, DutyTabs, ExchangesCard, OnDutyNowCard, ScheduleCard, YourShiftsCard } from '../features/duty-ops/DutyCards';
import { ExchangeV2Provider, ExchangeV2Summary, useExchangeCounts } from '../features/exchange/ExchangeV2';
import { AttentionDetail } from '../app/AttentionDetail';
import { Icon } from '../app/Icon';
import { Skeleton } from '../app/ui';
import { PERMISSIONS } from '../../../shared/authorization';
import '../features/duty-ops/duty-ops.css';
import '../features/duty-ops/credits.css';

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function DutyOpsPage({ view = 'schedule' }: { view?: 'schedule' | 'exchanges' }) {
  const { user, refresh } = useCurrentUser();
  const canSwap = user?.permissions?.includes(PERMISSIONS.dutyOpsSwap) === true;
  const [balance, setBalance] = useState<number | null>(null);
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
  const assignments = data?.shifts.map(shift => ({ id: shift.id,
    label: `${dateLabel(shift.startsAt)} · ${timeLabel(shift)}`,
    ownerNames: participantLabel(shift), own: shift.participants.some(person => person.isCurrentUser) })) ?? [];
  // Days ahead that FlightLogger is synced for, from today to the end of the window.
  const windowDays = data ? Math.max(1, Math.round((Date.parse(`${data.to}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) + 1) : 60;
  const retry = !!error || !!data?.sync.stale;
  return <section className={`duty-ops duty-page${center ? " duty-page--center" : ""}`}>
    <header className="duty-title">
      <div>
        <h1>{center ? 'Exchanges' : 'Duty Ops'}</h1>
        <p className="duty-subline" title={data ? `Times in Europe/Oslo · Schedule: ${cacheAgeLabel(data.sync.discovery.lastSyncedAt, now)} · Assignments: ${cacheAgeLabel(data.sync.assignments.lastSyncedAt, now)}` : undefined}>
          {data ? `Synced ${clock.format(new Date(data.sync.assignments.lastSyncedAt))} · ${windowDays} days from FlightLogger` : <Skeleton width={220} height={12} />}</p>
      </div>
      <button type="button" className="ui-button duty-refresh" onClick={() => setReload(n => n + 1)} disabled={loading} aria-label={retry ? 'Retry Duty Ops' : 'Refresh Duty Ops'}>
        <Icon name="reload" size={16} /><span className="duty-refresh-text">{retry ? 'Retry' : 'Refresh'}</span>
      </button>
    </header>
    {!sections && <DutyTabs canSwap={canSwap} />}
    {loading && !data && <DutyOpsSkeleton />}
    {error && <p className="duty-alert" role="alert">{error}</p>}
    {data?.sync.stale && <div role="status"><AttentionDetail label="Schedule may be out of date"><p>{data.sync.warning || 'Showing previously synchronized data. Reload to check for updates.'}</p></AttentionDetail></div>}
    {sections && data && <ExchangeV2Provider domain="DUTY_OPS" assignments={assignments} refreshKey={reload} onChanged={() => setReload(n => n + 1)}>
      <DutyExchanges shifts={data.shifts} now={now} refreshKey={reload} onChanged={() => setReload(n => n + 1)} onBalanceChanged={setBalance} showBoard={center} legacyOnly>
        <DutyTabs canSwap={canSwap} />
        {center ? <div className="card duty-center"><ExchangeV2Summary domain="DUTY_OPS" center /></div> : <ScheduleLayout
          onDuty={sections.onDutyNow.map(shift => <OnDutyNowCard key={shift.id} shift={shift} now={now} />)}
          mine={(sections.mine.length > 0 || sections.onDutyNow.length === 0) && <YourShiftsCard shifts={sections.mine} now={now} windowDays={windowDays} canSwap={canSwap} />}
          exchanges={<ExchangesCard balance={balance}><ExchangeV2Summary domain="DUTY_OPS" embedded /></ExchangesCard>}
          schedule={<ScheduleCard groups={sections.schedule} now={now} windowDays={windowDays} />} />}
      </DutyExchanges></ExchangeV2Provider>}
  </section>;
}

/** Phone order: on duty now, your shifts, exchanges, schedule; exchanges move up when something needs the user's answer. */
function ScheduleLayout({ onDuty, mine, exchanges, schedule }: { onDuty: ReactNode[]; mine: ReactNode; exchanges: ReactNode; schedule: ReactNode }) {
  const counts = useExchangeCounts();
  const urgent = (counts?.review ?? 0) > 0;
  return <div className="duty-layout">
    {onDuty}
    {urgent && exchanges}
    {mine}
    {!urgent && exchanges}
    {schedule}
  </div>;
}
export function DutyExchangeCenterPage() { return <DutyOpsPage view="exchanges" />; }
