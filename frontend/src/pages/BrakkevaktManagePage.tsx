import { useEffect, useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { osloDate } from '../dates';
import type { BrakkevaktRoster, BrakkevaktSchedule } from '../../../shared/brakkevakt';
import { displayName } from '../../../shared/display-name';
import { loadRoster, loadSchedule, removeWeek, saveWeek } from '../features/brakkevakt/api';
import { addDays, compactWeekTitle, weekLabel } from '../features/brakkevakt/presentation';
import { ActionButton, BackLink, PageHeader, RefreshControl } from '../app/controls';
import '../features/duty-ops/duty-ops.css';
import '../features/brakkevakt/brakkevakt.css';

type Draft = { weekStart: string; userIds: [string, string]; revision: number | null };
function monday(day: string) { const d = new Date(`${day}T12:00:00Z`); return addDays(day, -((d.getUTCDay() + 6) % 7)); }
export function BrakkevaktManagePage() {
  const { user } = useCurrentUser();
  const [schedule, setSchedule] = useState<BrakkevaktSchedule | null>(null), [roster, setRoster] = useState<BrakkevaktRoster | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]), [start, setStart] = useState(() => monday(osloDate(new Date()))), [count, setCount] = useState(10);
  const [baseline, setBaseline] = useState<Record<string, [string, string]>>({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [removing, setRemoving] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    void Promise.all([loadSchedule(controller.signal), loadRoster(controller.signal)]).then(([s, r]) => {
      if (!controller.signal.aborted) { setSchedule(s); setRoster(r);
        setBaseline(Object.fromEntries(s.weeks.map(w => [w.weekStart, [w.assignments[0].user.id, w.assignments[1].user.id]])));
        setDrafts(s.weeks.filter(w => addDays(w.weekStart, 7) > osloDate(new Date())).map(w => ({ weekStart: w.weekStart,
          userIds: [w.assignments[0].user.id, w.assignments[1].user.id], revision: w.revision }))); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load schedule editor.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload, user?.subject]);
  function generate() {
    setError(''); setStatus('');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || monday(start) !== start || count < 1 || count > 26 || !Number.isInteger(count)) {
      setError('Choose a Monday and 1–26 weeks.'); return;
    }
    const first = monday(osloDate(new Date()));
    if (start < first) { setError('Choose the current or a future Monday.'); return; }
    setDrafts(previous => {
      const next = [...previous];
      for (let i = 0; i < count; i++) { const weekStart = addDays(start, 7 * i);
        if (!next.some(row => row.weekStart === weekStart)) next.push({ weekStart, userIds: ['', ''], revision: null }); }
      return next.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    });
  }
  function setPerson(weekStart: string, index: 0 | 1, value: string) {
    setDrafts(rows => rows.map(row => row.weekStart === weekStart ? { ...row,
      userIds: index === 0 ? [value, row.userIds[1]] : [row.userIds[0], value] } : row));
  }
  async function persist(rows: Draft[]) {
    if (busy) return;
    setBusy(true); setError(''); setStatus(''); let saved = 0;
    try {
      for (const row of rows) {
        if (!row.userIds[0] || !row.userIds[1] || row.userIds[0] === row.userIds[1]) throw new Error(`Select two different students for ${weekLabel(row.weekStart)}.`);
        const revision = await saveWeek(row.weekStart, row.userIds, row.revision); saved++;
        setDrafts(previous => previous.map(draft => draft.weekStart === row.weekStart ? { ...draft, revision } : draft));
        setBaseline(previous => ({ ...previous, [row.weekStart]: row.userIds }));
      }
      setStatus(`${saved} ${saved === 1 ? 'week' : 'weeks'} saved.`);
    } catch (cause) { setError(`${saved ? `${saved} weeks saved. ` : ''}${cause instanceof Error ? cause.message : 'Could not save schedule.'}`); }
    finally { setBusy(false); }
  }
  async function remove(row: Draft) {
    if (busy || row.revision === null) return;
    setBusy(true); setError(''); setStatus('');
    try { await removeWeek(row.weekStart, row.revision); setRemoving(''); setStatus(`${weekLabel(row.weekStart)} removed.`);
      setDrafts(rows => rows.filter(draft => draft.weekStart !== row.weekStart)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove week.'); }
    finally { setBusy(false); }
  }
  const changed = drafts.filter(row => {
    if (!row.userIds[0] || !row.userIds[1] || row.userIds[0] === row.userIds[1]) return false;
    const original = baseline[row.weekStart];
    return !original || original.some((userId, index) => userId !== row.userIds[index]);
  });
  return <section className="duty-ops brakkevakt"><BackLink to="/brakkevakt">Brakkevakt</BackLink><PageHeader title="Manage Brakkevakt"><RefreshControl label="Brakkevakt schedule" onRefresh={() => setReload(v => v + 1)} loading={loading || busy} retry={!!error} /></PageHeader>
    {loading && <p role="status" className="duty-loading">Loading editor…</p>}{error && <p role="alert" className="duty-alert">{error}</p>}
    {status && <p role="status" className="exchange-note">{status}</p>}
    {schedule && roster && <><div className="brakkevakt-generator"><label>Start week<select value={start} onChange={e => setStart(e.target.value)} disabled={busy}>{Array.from({ length: 53 }, (_, index) => addDays(monday(osloDate(new Date())), index * 7)).map(week => <option key={week} value={week}>{compactWeekTitle(week)}</option>)}</select></label>
      <label>Number of weeks<input type="number" min="1" max="26" value={count} onChange={e => setCount(Number(e.target.value))} disabled={busy} /></label>
      <ActionButton disabled={busy} onClick={generate}>Generate weeks</ActionButton></div>
      <p className="exchange-note">Choose two students per week. Generated rows are drafts until saved.</p>
      {drafts.length ? <><div className="brakkevakt-manage-actions"><ActionButton variant="primary" disabled={busy || !changed.length}
        onClick={() => void persist(changed)}>Save changes</ActionButton></div>
        <div>{drafts.map(row => <div className="brakkevakt-manage-row" key={row.weekStart}>
          <strong title={weekLabel(row.weekStart, true)}>{compactWeekTitle(row.weekStart)}</strong>
          {([0, 1] as const).map(index => <label key={index}>Person {index + 1}<select value={row.userIds[index]} disabled={busy} onChange={e => setPerson(row.weekStart, index, e.target.value)}>
            <option value="">Choose student</option>{roster.students.map(student => <option key={student.id} value={student.id}>{displayName(student)}</option>)}
          </select></label>)}
          <div className="brakkevakt-manage-actions">{row.revision === null ? <button disabled={busy} onClick={() => setDrafts(rows => rows.filter(d => d.weekStart !== row.weekStart))}>Discard draft</button>
              : row.weekStart > schedule.currentWeekStart && (removing === row.weekStart ? <><ActionButton variant="danger" disabled={busy} onClick={() => void remove(row)}>Confirm remove</ActionButton>
                  <ActionButton variant="ghost" disabled={busy} onClick={() => setRemoving('')}>Keep</ActionButton></> : <ActionButton variant="danger" disabled={busy} onClick={() => setRemoving(row.weekStart)}>Remove</ActionButton>)}</div>
        </div>)}</div></> : <p className="duty-empty">No current or upcoming weeks. Generate rows to prepare the schedule.</p>}
    </>}
  </section>;
}
