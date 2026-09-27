import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../../app/Icon';
import { useCurrentUser } from '../../app/CurrentUser';
import { OnboardingRequiredError } from '../../api';
import { osloDate } from '../../dates';
import { loadDutyOps } from './api';
import { dutySections } from './presentation';
import { ShiftList } from './ShiftList';
import type { DutyOpsData } from './types';
import './duty-ops.css';

// Mounted only when Home has duty_ops.view; identity changes reset this snapshot.
export function HomeDutyOps({ now }: { now: number }) {
  const { refresh } = useCurrentUser();
  const [state, setState] = useState<{ data: DutyOpsData | null; loading: boolean; error: boolean }>({ data: null, loading: true, error: false });
  const today = osloDate(new Date(now));
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, loading: true, error: false });
    loadDutyOps(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ data, loading: false, error: false });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (cause instanceof OnboardingRequiredError) void refresh().catch(() => {});
      setState({ data: null, loading: false, error: true });
    });
    return () => controller.abort();
  }, [today, refresh]);
  const sections = state.data ? dutySections(state.data.shifts, now) : null;
  const next = sections?.today.length === 0 ? sections.mine[0] : undefined;
  const shifts = sections?.today.length ? sections.today : next ? [next] : [];
  return <section className="today-overview home-duty-summary" aria-labelledby="today-heading">
    <h2 id="today-heading">Today</h2>
    {state.loading && <p role="status">Loading Duty Ops…</p>}
    {state.error && <p role="alert">Duty Ops unavailable. <Link to="/duty-ops">Open Duty Ops</Link></p>}
    {sections && <>
      {!sections.today.length && <p>Nothing scheduled</p>}
      {shifts.length > 0 && <>
        <div className="home-duty-heading"><h3><Link to="/duty-ops"><Icon name="duty" />{next ? 'Your next Duty Ops' : 'Duty Ops'}<Icon name="arrow-right" /></Link></h3><span>Europe/Oslo</span></div>
        <ShiftList shifts={shifts} showDate={!!next} />
      </>}
      {state.data?.sync.stale && <p className="home-duty-freshness" role="status">Schedule may be out of date. <Link to="/duty-ops">Check Duty Ops</Link></p>}
    </>}
  </section>;
}
