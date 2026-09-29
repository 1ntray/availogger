import { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { osloDate } from '../dates';
import { PERMISSIONS } from '../../../shared/authorization';
import { displayName } from '../../../shared/display-name';
import type { BrakkevaktSchedule, BrakkevaktWeek, BrakkevaktSwaps, BrakkevaktSwapRequest, BrakkevaktSwapProposal } from '../../../shared/brakkevakt';
import { loadSchedule, loadSwaps, mutateSwap } from '../features/brakkevakt/api';
import { addDays, compactWeekTitle, ownAssignment, personName, weekLabel } from '../features/brakkevakt/presentation';
import { ActionButton, PageHeader, RefreshControl } from '../app/controls';
import { BackLink } from '../app/controls';
import { Link, useLocation } from 'react-router';
import { ExchangeStart } from '../features/exchange/ExchangeStart';
import { hasOwnOpenOffer, openProposals, openRequests, ownOfferFor, ownRequestFor } from '../features/exchange/v1-presentation';
import '../features/duty-ops/duty-ops.css';
import '../features/duty-ops/exchanges.css';
import '../features/brakkevakt/brakkevakt.css';

type Dialog = { kind: 'start'; assignmentId: string; weekStart: string }
  | { kind: 'create'; assignmentId: string; weekStart: string }
  | { kind: 'propose'; request: BrakkevaktSwapRequest }
  | { kind: 'cancel'; request: BrakkevaktSwapRequest }
  | { kind: 'accept' | 'withdraw'; request: BrakkevaktSwapRequest; proposal: BrakkevaktSwapProposal };
export function BrakkevaktPage({ view = 'schedule' }: { view?: 'schedule' | 'exchanges' }) {
  const { user } = useCurrentUser();
  const canSwap = user?.permissions?.includes(PERMISSIONS.brakkevaktSwap) === true;
  const [data, setData] = useState<BrakkevaktSchedule | null>(null), [swaps, setSwaps] = useState<BrakkevaktSwaps | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [swapError, setSwapError] = useState('');
  const [busy, setBusy] = useState(false), [reload, setReload] = useState(0), [now, setNow] = useState(Date.now);
  const [dialog, setDialog] = useState<Dialog | null>(null), [offeredId, setOfferedId] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null), saving = useRef(false), opener = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const center = view === 'exchanges';
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
  const open = (next: Dialog, selectedAssignmentId = '') => { if (!dialog) opener.current = document.activeElement as HTMLElement; setSwapError(''); setOfferedId(selectedAssignmentId); setDialog(next); };
  async function mutate(path: string, body: object = {}) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setSwapError('');
    try { await mutateSwap(path, body); setDialog(null); setReload(v => v + 1); }
    catch (cause) { setSwapError(cause instanceof Error ? cause.message : 'Could not save swap.'); }
    finally { saving.current = false; setBusy(false); }
  }
  function confirm() {
    if (!dialog || dialog.kind === 'start') return;
    if (dialog.kind === 'create') { void mutate('', { assignmentId: dialog.assignmentId }); return; }
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
    const assignment = data && ownAssignment(week, data.currentUserId);
    const active = openRequests(swaps?.requests ?? []);
    const userId = swaps?.currentUserId ?? '';
    const request = assignment && ownRequestFor(active, userId, assignment.id, item => item.requestedAssignmentId);
    const offer = assignment && ownOfferFor(active, userId, assignment.id, item => item.offeredAssignmentId);
    const otherRequest = !assignment && active.find(item => week.assignments.some(slot => slot.id === item.requestedAssignmentId));
    return <li className={`brakkevakt-week${week.weekStart === data?.currentWeekStart ? ' brakkevakt-current' : ''}${assignment ? ' brakkevakt-mine' : ''}`}>
      <time dateTime={week.weekStart} title={weekLabel(week.weekStart, true)}>{compactWeekTitle(week.weekStart)}</time>
      <p>{week.assignments.map(a => personName(a.user)).join(' · ')}</p>
      {action && canSwap && addDays(week.weekStart, 7) > today && (assignment
        ? request ? <div className="exchange-assignment-state"><span>Looking for swap{openProposals(request).length ? ` · ${openProposals(request).length} ${openProposals(request).length === 1 ? 'offer' : 'offers'}` : ''}</span>
            <ActionButton disabled={busy} onClick={() => open({ kind: 'cancel', request })}>Cancel</ActionButton>
            <Link to={`/brakkevakt/exchanges#brakkevakt-exchange-${encodeURIComponent(request.id)}`}>{openProposals(request).length ? 'Review offers' : 'Open exchange'}</Link></div>
          : offer ? <div className="exchange-assignment-state"><span>Offer sent</span><ActionButton disabled={busy} onClick={() => open({ kind: 'withdraw', ...offer })}>Withdraw offer</ActionButton>
            <Link to={`/brakkevakt/exchanges#brakkevakt-exchange-${encodeURIComponent(offer.request.id)}`}>Open exchange</Link></div>
          : swaps?.lockedAssignmentIds.includes(assignment.id) ? <div className="exchange-assignment-state"><span>Exchange active</span><Link to="/brakkevakt/exchanges">Open exchange center</Link></div>
          : <ActionButton disabled={busy || !swaps} onClick={() => open({ kind: 'start', assignmentId: assignment.id, weekStart: week.weekStart })}>Exchange</ActionButton>
        : otherRequest ? <div className="exchange-assignment-state"><span>{hasOwnOpenOffer(otherRequest, userId) ? 'Offer sent' : 'Swap wanted'}</span>
            {otherRequest.eligible && !hasOwnOpenOffer(otherRequest, userId) && eligible.some(a => a.weekStart !== otherRequest.requestedWeekStart) &&
              <ActionButton disabled={busy} onClick={() => open({ kind: 'propose', request: otherRequest })}>Offer your week</ActionButton>}</div> : null)}
    </li>;
  }
  function renderRequest(request: BrakkevaktSwapRequest) {
    const own = request.requester.id === swaps?.currentUserId;
    const canOffer = eligible.some(a => a.weekStart !== request.requestedWeekStart);
    const sent = hasOwnOpenOffer(request, swaps!.currentUserId);
    return <li className="exchange-row" id={`brakkevakt-exchange-${request.id}`} tabIndex={-1} key={request.id}>
      <div className="exchange-row-heading"><strong>{personName(request.requester)} wants to swap</strong><span>{request.eligible ? 'Open' : 'No longer eligible'}</span></div>
      <p className="exchange-time">{weekLabel(request.requestedWeekStart)}</p>
      <div className="exchange-actions">{own ? <button disabled={busy} onClick={() => open({ kind: 'cancel', request })}>Cancel request</button>
        : sent ? <span className="exchange-inline-status">Offer sent</span> : request.eligible && canOffer &&
          <button disabled={busy} onClick={() => open({ kind: 'propose', request })}>Offer a week</button>}</div>
      {!!openProposals(request).length && <ul className="exchange-proposals" aria-label="Swap offers">{openProposals(request).map(p => <li key={p.id}>
        <strong>{personName(p.proposer)}</strong> offers {weekLabel(p.offeredWeekStart)}
        <div className="exchange-actions">{own ? request.eligible && p.eligible && <button disabled={busy} onClick={() => open({ kind: 'accept', request, proposal: p })}>Choose this swap</button>
          : p.proposer.id === swaps?.currentUserId && <button disabled={busy} onClick={() => open({ kind: 'withdraw', request, proposal: p })}>Withdraw offer</button>}</div>
      </li>)}</ul>}
    </li>;
  }
  const active = openRequests(swaps?.requests ?? []).map(request => ({ ...request, proposals: openProposals(request) }));
  const ownRequests = active.filter(r => r.requester.id === swaps?.currentUserId || r.proposals.some(p => p.proposer.id === swaps?.currentUserId));
  const available = active.filter(r => r.requester.id !== swaps?.currentUserId && r.eligible && !ownRequests.includes(r));
  const posted = active.filter(r => r.requester.id === swaps?.currentUserId);
  const offersForYou = posted.reduce((count, request) => count + request.proposals.length, 0);
  useEffect(() => {
    if (!center || !swaps || !location.hash.startsWith('#brakkevakt-exchange-')) return;
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.focus();
  }, [center, swaps, location.hash]);
  return <section className="duty-ops brakkevakt">
    {center && <BackLink to="/brakkevakt">Brakkevakt</BackLink>}
    <PageHeader title={center ? 'Exchanges' : 'Brakkevakt'}><div className="duty-heading-actions">{!center && user?.permissions.includes(PERMISSIONS.brakkevaktManageSchedule) && <Link to="/brakkevakt/manage">Manage schedule</Link>}<RefreshControl label="Brakkevakt" onRefresh={() => setReload(v => v + 1)} loading={loading} retry={!!error} /></div></PageHeader>
    {loading && !data && <p role="status" className="duty-loading">Loading Brakkevakt…</p>}{error && <p role="alert" className="duty-alert">{error}</p>}
    {data && !center && <><section><h2>This week</h2>{current ? <ul><Week week={current} action /></ul> : <p className="duty-empty">No one scheduled this week</p>}</section>
      {upcoming.length > 0 && <section><h2>Upcoming</h2><ul>{upcoming.map(w => <Week key={w.id} week={w} action />)}</ul></section>}
    </>}
    {canSwap && !center && <section className="exchange-overview" aria-labelledby="brakkevakt-swap-overview"><h2 id="brakkevakt-swap-overview">Exchanges</h2>
      {swapError && <p role="alert" className="duty-alert">{swapError}</p>}
      {swaps && !swaps.nextCursor && <p>Available {available.length} · Your requests {posted.length} · Offers for you {offersForYou}</p>}
      <Link to="/brakkevakt/exchanges">View exchange center →</Link>
    </section>}
    {canSwap && center && <section className="duty-exchanges" aria-label="Exchanges">
      {swapError && !dialog && <p role="alert" className="duty-alert">{swapError}</p>}
      {swaps && <>{available.length > 0 && <><h3>Available swaps</h3><ul>{available.map(renderRequest)}</ul></>}
        {ownRequests.length > 0 && <><h3>My swaps</h3><ul>{ownRequests.map(renderRequest)}</ul></>}
        {!active.length && <p className="duty-empty">No open exchanges</p>}
        {swaps.nextCursor && <button disabled={busy} onClick={() => void more()}>Load more swaps</button>}</>}
    </section>}
    {dialog && <dialog ref={dialogRef} className={`exchange-dialog${dialog.kind === 'start' ? ' exchange-dialog-start' : ''}`} aria-labelledby="brakkevakt-dialog-title" onCancel={e => { e.preventDefault(); if (!busy) setDialog(null); }}>
      <h3 id="brakkevakt-dialog-title">{dialog.kind === 'start' ? 'Exchange week' : dialog.kind === 'create' ? 'Post week for swap' : dialog.kind === 'propose' ? 'Offer a Brakkevakt week' : dialog.kind === 'accept' ? 'Confirm direct swap' : dialog.kind === 'withdraw' ? 'Withdraw offer?' : 'Cancel request?'}</h3>
      <form onSubmit={e => { e.preventDefault(); confirm(); }}>
        {dialog.kind === 'start' ? <ExchangeStart assignment={weekLabel(dialog.weekStart)} busy={busy}
          opportunities={available.filter(request => request.requestedWeekStart !== dialog.weekStart && !hasOwnOpenOffer(request, swaps!.currentUserId)).map(request => ({
            id: request.id, label: weekLabel(request.requestedWeekStart), person: personName(request.requester),
            onOffer: () => open({ kind: 'propose', request }, dialog.assignmentId),
          }))} onPost={() => setDialog({ kind: 'create', assignmentId: dialog.assignmentId, weekStart: dialog.weekStart })} />
          : <p className="exchange-time">{weekLabel(dialog.kind === 'create' ? dialog.weekStart : dialog.request.requestedWeekStart)}</p>}
        {dialog.kind === 'propose' && <label className="exchange-select">Your week<select value={offeredId} onChange={e => setOfferedId(e.target.value)} required disabled={busy}>
          <option value="">Choose a week</option>{eligible.filter(a => a.weekStart !== dialog.request.requestedWeekStart).map(a => <option key={a.id} value={a.id}>{weekLabel(a.weekStart)}</option>)}
        </select></label>}
        {dialog.kind === 'accept' && <p>You give {weekLabel(dialog.request.requestedWeekStart)} and receive {weekLabel(dialog.proposal.offeredWeekStart)} from {displayName(dialog.proposal.proposer)}.</p>}
        {swapError && <p role="alert" className="duty-alert">{swapError}</p>}
        <div className="exchange-actions"><ActionButton variant="ghost" disabled={busy} onClick={() => setDialog(null)}>{dialog.kind === 'start' ? 'Close' : 'Cancel'}</ActionButton>
          {dialog.kind !== 'start' && <ActionButton variant="primary" type="submit" disabled={busy || (dialog.kind === 'propose' && !offeredId)}>{busy ? 'Saving…' : dialog.kind === 'create' ? 'Publish request' : dialog.kind === 'accept' ? 'Confirm swap' : dialog.kind === 'propose' ? 'Offer week' : dialog.kind === 'withdraw' ? 'Withdraw offer' : 'Cancel request'}</ActionButton>}</div>
      </form></dialog>}
  </section>;
}
export function BrakkevaktExchangeCenterPage() { return <BrakkevaktPage view="exchanges" />; }
