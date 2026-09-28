import { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { osloDate } from '../dates';
import { PERMISSIONS } from '../../../shared/authorization';
import { displayName } from '../../../shared/display-name';
import type { BrakkevaktSchedule, BrakkevaktWeek, BrakkevaktSwaps, BrakkevaktSwapRequest, BrakkevaktSwapProposal } from '../../../shared/brakkevakt';
import { loadSchedule, loadSwaps, mutateSwap } from '../features/brakkevakt/api';
import { addDays, ownAssignment, partner, personName, weekLabel, weekTitle } from '../features/brakkevakt/presentation';
import { Link } from 'react-router';
import '../features/duty-ops/duty-ops.css';
import '../features/duty-ops/exchanges.css';
import '../features/brakkevakt/brakkevakt.css';

type Dialog = { kind: 'propose'; request: BrakkevaktSwapRequest }
  | { kind: 'cancel'; request: BrakkevaktSwapRequest }
  | { kind: 'accept' | 'withdraw'; request: BrakkevaktSwapRequest; proposal: BrakkevaktSwapProposal };
export function BrakkevaktPage() {
  const { user } = useCurrentUser();
  const canSwap = user?.permissions?.includes(PERMISSIONS.brakkevaktSwap) === true;
  const [data, setData] = useState<BrakkevaktSchedule | null>(null), [swaps, setSwaps] = useState<BrakkevaktSwaps | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [swapError, setSwapError] = useState('');
  const [busy, setBusy] = useState(false), [reload, setReload] = useState(0), [now, setNow] = useState(Date.now);
  const [dialog, setDialog] = useState<Dialog | null>(null), [offeredId, setOfferedId] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null), saving = useRef(false), opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()); if (!document.hidden) setReload(v => v + 1); }, 60_000);
    const visible = () => { if (!document.hidden) setReload(v => v + 1); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setSwapError('');
    void loadSchedule(controller.signal).then(v => { if (!controller.signal.aborted) setData(v); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load Brakkevakt.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    if (canSwap) void loadSwaps(controller.signal).then(v => { if (!controller.signal.aborted) setSwaps(v); })
      .catch(cause => { if (!controller.signal.aborted) setSwapError(cause instanceof Error ? cause.message : 'Could not load swaps.'); });
    else setSwaps(null);
    return () => controller.abort();
  }, [reload, user?.subject, canSwap]);
  useEffect(() => { if (dialog && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    if (!dialog && opener.current?.isConnected) { opener.current.focus(); opener.current = null; } }, [dialog]);
  const today = osloDate(new Date(now)), current = data?.weeks.find(w => w.weekStart === data.currentWeekStart);
  const upcoming = data?.weeks.filter(w => w.weekStart > (data?.currentWeekStart ?? today)) ?? [];
  const mine = data?.weeks.filter(w => addDays(w.weekStart, 7) > today && w.assignments.some(a => a.user.id === data.currentUserId)) ?? [];
  const eligible = mine.flatMap(w => w.assignments.filter(a => a.user.id === data?.currentUserId && !swaps?.lockedAssignmentIds.includes(a.id)).map(a => ({ ...a, weekStart: w.weekStart })));
  const open = (next: Dialog) => { opener.current = document.activeElement as HTMLElement; setSwapError(''); setOfferedId(''); setDialog(next); };
  async function mutate(path: string, body: object = {}) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setSwapError('');
    try { await mutateSwap(path, body); setDialog(null); setReload(v => v + 1); }
    catch (cause) { setSwapError(cause instanceof Error ? cause.message : 'Could not save swap.'); }
    finally { saving.current = false; setBusy(false); }
  }
  function confirm() {
    if (!dialog) return;
    const base = `/${encodeURIComponent(dialog.request.id)}`;
    if (dialog.kind === 'propose') { if (offeredId) void mutate(`${base}/proposals`, { assignmentId: offeredId }); }
    else if (dialog.kind === 'cancel') void mutate(`${base}/cancel`);
    else void mutate(`${base}/proposals/${encodeURIComponent(dialog.proposal.id)}/${dialog.kind}`);
  }
  async function more() {
    if (!swaps?.nextCursor || saving.current) return;
    saving.current = true; setBusy(true);
    try { const next = await loadSwaps(new AbortController().signal, swaps.nextCursor);
      setSwaps(old => old ? { ...next, requests: [...old.requests, ...next.requests.filter(r => !old.requests.some(o => o.id === r.id))] } : next);
    } catch (cause) { setSwapError(cause instanceof Error ? cause.message : 'Could not load swaps.'); }
    finally { saving.current = false; setBusy(false); }
  }
  function Week({ week, action = false }: { week: BrakkevaktWeek; action?: boolean }) {
    const assignment = data && ownAssignment(week, data.currentUserId), paired = data && partner(week, data.currentUserId);
    return <li className={`brakkevakt-week${week.weekStart === data?.currentWeekStart ? ' brakkevakt-current' : ''}${assignment ? ' brakkevakt-mine' : ''}`}>
      <time dateTime={week.weekStart}>{weekTitle(week.weekStart)}</time>
      <p>{week.assignments.map(a => personName(a.user)).join(' · ')}</p>
      {assignment && action && <><p className="exchange-note">Together with {paired ? personName(paired) : 'Student'}</p>
        {canSwap && addDays(week.weekStart, 7) > today && (swaps?.lockedAssignmentIds.includes(assignment.id)
          ? <p className="exchange-note">Assignment has an active swap</p>
          : <button disabled={busy || !swaps} onClick={() => void mutate('', { assignmentId: assignment.id })}>Look for swap</button>)}</>}
    </li>;
  }
  function renderRequest(request: BrakkevaktSwapRequest) {
    const own = request.requester.id === swaps?.currentUserId;
    const canOffer = eligible.some(a => a.weekStart !== request.requestedWeekStart);
    return <li className="exchange-row" key={request.id}>
      <div className="exchange-row-heading"><strong>{personName(request.requester)} wants to swap</strong><span>{request.eligible ? 'Open' : 'No longer eligible'}</span></div>
      <p className="exchange-time">{weekLabel(request.requestedWeekStart)}</p>
      <div className="exchange-actions">{own ? <button disabled={busy} onClick={() => open({ kind: 'cancel', request })}>Cancel request</button>
        : request.eligible && <button disabled={busy || !canOffer || request.proposals.some(p => p.proposer.id === swaps?.currentUserId)} onClick={() => open({ kind: 'propose', request })}>Offer a week</button>}</div>
      {!!request.proposals.length && <ul className="exchange-proposals" aria-label="Swap offers">{request.proposals.map(p => <li key={p.id}>
        <strong>{personName(p.proposer)}</strong> offers {weekLabel(p.offeredWeekStart)}
        <div className="exchange-actions">{own ? <button disabled={busy || !request.eligible || !p.eligible} onClick={() => open({ kind: 'accept', request, proposal: p })}>Choose this swap</button>
          : p.proposer.id === swaps?.currentUserId && <button disabled={busy} onClick={() => open({ kind: 'withdraw', request, proposal: p })}>Withdraw offer</button>}</div>
      </li>)}</ul>}
    </li>;
  }
  const ownRequests = swaps?.requests.filter(r => r.requester.id === swaps.currentUserId || r.proposals.some(p => p.proposer.id === swaps.currentUserId)) ?? [];
  const available = swaps?.requests.filter(r => r.requester.id !== swaps.currentUserId && r.eligible && !ownRequests.includes(r)) ?? [];
  return <section className="duty-ops brakkevakt">
    <div className="duty-heading"><h1>Brakkevakt</h1><div className="duty-heading-actions">{user?.permissions.includes(PERMISSIONS.brakkevaktManageSchedule) && <Link to="/brakkevakt/manage">Manage schedule</Link>}<button onClick={() => setReload(v => v + 1)} disabled={loading}>Reload</button></div></div>
    {loading && <p role="status" className="duty-loading">Loading Brakkevakt…</p>}{error && <p role="alert" className="duty-alert">{error}</p>}
    {data && <><section><h2>This week</h2>{current ? <ul><Week week={current} action /></ul> : <p className="duty-empty">No one scheduled this week</p>}</section>
      <section><h2>Upcoming</h2>{upcoming.length ? <ul>{upcoming.map(w => <Week key={w.id} week={w} action />)}</ul> : <p className="duty-empty">No upcoming weeks scheduled</p>}</section>
    </>}
    {canSwap && <section className="duty-exchanges" aria-labelledby="brakkevakt-swap-title"><h2 id="brakkevakt-swap-title">Direct swaps</h2>
      {swapError && !dialog && <p role="alert" className="duty-alert">{swapError}</p>}
      {swaps && <>{available.length > 0 && <><h3>Available swaps</h3><ul>{available.map(renderRequest)}</ul></>}
        {ownRequests.length > 0 && <><h3>My swaps</h3><ul>{ownRequests.map(renderRequest)}</ul></>}
        {!available.length && !ownRequests.length && <p className="duty-empty">No open swaps</p>}
        {swaps.nextCursor && <button disabled={busy} onClick={() => void more()}>Load more swaps</button>}</>}
    </section>}
    {dialog && <dialog ref={dialogRef} className="exchange-dialog" aria-labelledby="brakkevakt-dialog-title" onCancel={e => { e.preventDefault(); if (!busy) setDialog(null); }}>
      <h3 id="brakkevakt-dialog-title">{dialog.kind === 'propose' ? 'Offer a Brakkevakt week' : dialog.kind === 'accept' ? 'Confirm direct swap' : dialog.kind === 'withdraw' ? 'Withdraw offer?' : 'Cancel request?'}</h3>
      <form onSubmit={e => { e.preventDefault(); confirm(); }}>
        <p className="exchange-time">{weekLabel(dialog.request.requestedWeekStart)}</p>
        {dialog.kind === 'propose' && <label className="exchange-select">Your week<select value={offeredId} onChange={e => setOfferedId(e.target.value)} required disabled={busy}>
          <option value="">Choose a week</option>{eligible.filter(a => a.weekStart !== dialog.request.requestedWeekStart).map(a => <option key={a.id} value={a.id}>{weekLabel(a.weekStart)}</option>)}
        </select></label>}
        {dialog.kind === 'accept' && <p>You give {weekLabel(dialog.request.requestedWeekStart)} and receive {weekLabel(dialog.proposal.offeredWeekStart)} from {displayName(dialog.proposal.proposer)}.</p>}
        {swapError && <p role="alert" className="duty-alert">{swapError}</p>}
        <div className="exchange-actions"><button type="button" disabled={busy} onClick={() => setDialog(null)}>Back</button>
          <button type="submit" disabled={busy || (dialog.kind === 'propose' && !offeredId)}>{busy ? 'Saving…' : dialog.kind === 'accept' ? 'Confirm swap' : dialog.kind === 'propose' ? 'Propose swap' : dialog.kind === 'withdraw' ? 'Withdraw offer' : 'Cancel request'}</button></div>
      </form></dialog>}
  </section>;
}
