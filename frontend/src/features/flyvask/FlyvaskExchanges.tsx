import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useCurrentUser } from '../../app/CurrentUser';
import { PERMISSIONS } from '../../../../shared/authorization';
import { osloDate } from '../../dates';
import { shiftLabel, userName } from './exchange-presentation';
import type { FlyvaskShift } from './types';
import { loadExchanges, saveExchange, type ExchangeRequest, type ExchangeProposal, type ExchangesResponse } from './exchange-api';
import '../duty-ops/exchanges.css';
import { ActionButton } from '../../app/controls';
import { Link, useLocation } from 'react-router';
import { ExchangeStart } from '../exchange/ExchangeStart';
import { hasOwnOpenOffer, openProposals, openRequests, ownOfferFor, ownRequestFor } from '../exchange/v1-presentation';
import { ExchangeV2AssignmentAction } from '../exchange/ExchangeV2';

type DialogState = { kind: 'start'; shift: FlyvaskShift } | { kind: 'create'; shift: FlyvaskShift } | { kind: 'cancel' | 'propose'; request: ExchangeRequest }
  | { kind: 'accept' | 'withdraw'; request: ExchangeRequest; proposal: ExchangeProposal };
type Controls = { enabled: boolean; busy: boolean; data: ExchangesResponse | null; now: number; hasEligibleShift: boolean;
  legacyOnly: boolean; open: (dialog: DialogState, offeredId?: string) => void };
const ExchangeContext = createContext<Controls | null>(null);
export function ExchangeShiftActions({ shift }: { shift: FlyvaskShift }) {
  const state = useContext(ExchangeContext);
  if (!state?.enabled || (!state.legacyOnly && (shift.status !== 'OPEN' || Date.parse(shift.startsAt) <= state.now))) return null;
  if (state.legacyOnly && !state.data) return null;
  const own = shift.participants.some(p => p.isCurrentUser);
  const requests = state.data?.requests ?? [];
  const userId = state.data?.currentUserId ?? '';
  if (own) {
    const request = ownRequestFor(requests, userId, shift.id, item => item.requestedShift.id);
    if (request) {
      const offers = openProposals(request).length;
      return <div className="exchange-assignment-state"><span>Looking for swap{offers ? ` · ${offers} ${offers === 1 ? 'offer' : 'offers'}` : ''}</span>
        <ActionButton disabled={state.busy} onClick={() => state.open({ kind: 'cancel', request })}>Cancel</ActionButton>
        <Link to={`/flyvask/exchanges#flyvask-exchange-${encodeURIComponent(request.id)}`}>{offers ? 'Review offers' : 'Open exchange'}</Link></div>;
    }
    const offer = ownOfferFor(requests, userId, shift.id, item => item.offeredShift.id);
    if (offer) return <div className="exchange-assignment-state"><span>Offer sent</span><ActionButton disabled={state.busy} onClick={() => state.open({ kind: 'withdraw', ...offer })}>Withdraw offer</ActionButton>
      <Link to={`/flyvask/exchanges#flyvask-exchange-${encodeURIComponent(offer.request.id)}`}>Open exchange</Link></div>;
    if (state.data?.lockedShiftIds.includes(shift.id)) return <div className="exchange-assignment-state"><span>Exchange active</span><Link to="/flyvask/exchanges">Open exchange center</Link></div>;
    return state.legacyOnly ? <ExchangeV2AssignmentAction assignmentId={shift.id} /> :
      <ActionButton className="exchange-shift-action" disabled={state.busy || !state.data} onClick={() => state.open({ kind: 'start', shift })}>Exchange</ActionButton>;
  }
  const request = openRequests(requests).find(item => item.requestedShift.id === shift.id);
  if (!request) return state.legacyOnly ? <ExchangeV2AssignmentAction assignmentId={shift.id} /> : null;
  if (hasOwnOpenOffer(request, userId)) return <span className="exchange-inline-status">Offer sent</span>;
  return <div className="exchange-assignment-state"><span>Swap wanted</span>{request.eligible && state.hasEligibleShift &&
    <ActionButton disabled={state.busy} onClick={() => state.open({ kind: 'propose', request })}>Offer your shift</ActionButton>}</div>;
}

export function FlyvaskExchanges({ children, shifts, now, refreshKey, onChanged, showBoard = false, legacyOnly = false }: { children: ReactNode; shifts: FlyvaskShift[]; now: number; refreshKey: number; onChanged?: () => void; showBoard?: boolean; legacyOnly?: boolean }) {
  const { user } = useCurrentUser();
  const enabled = user?.permissions?.includes(PERMISSIONS.flyvaskSwap) === true;
  const [data, setData] = useState<ExchangesResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [offeredId, setOfferedId] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const saving = useRef(false);
  const lifecycle = useRef(0);
  const today = osloDate(new Date(now));
  const location = useLocation();
  useEffect(() => {
    const controller = new AbortController(); lifecycle.current++;
    setData(null); setError(''); setLoading(enabled); setDialog(null);
    if (enabled) loadExchanges(controller.signal).then(value => { if (!controller.signal.aborted) setData(value); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load swaps.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); lifecycle.current++; };
  }, [enabled, refreshKey, version, today, user?.subject]);
  useEffect(() => {
    if (dialog && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    if (!dialog && opener.current?.isConnected) { opener.current.focus(); opener.current = null; }
  }, [dialog]);
  const open = (next: DialogState, selectedShiftId = '') => { if (!dialog) opener.current = document.activeElement as HTMLElement; setError(''); setOfferedId(selectedShiftId); setDialog(next); };
  const eligible = shifts.filter(s => s.status === 'OPEN' && Date.parse(s.startsAt) > now && s.participants.some(p => p.isCurrentUser) && !data?.lockedShiftIds.includes(s.id));
  async function mutate(operation: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError(''); const generation = lifecycle.current;
    try {
      await operation();
      if (generation === lifecycle.current) { setDialog(null); setVersion(v => v + 1); onChanged?.(); }
    } catch (cause) {
      if (generation === lifecycle.current) setError(cause instanceof Error ? cause.message : 'Could not save the swap.');
    } finally { saving.current = false; setBusy(false); }
  }
  function confirm() {
    if (!dialog) return;
    if (dialog.kind === 'start') return;
    if (dialog.kind === 'create') { void mutate(() => saveExchange('', { shiftId: dialog.shift.id, startsAt: dialog.shift.startsAt, endsAt: dialog.shift.endsAt })); return; }
    const root = `/${encodeURIComponent(dialog.request.id)}`;
    if (dialog.kind === 'propose') {
      const shift = eligible.find(s => s.id === offeredId); if (!shift) return;
      void mutate(() => saveExchange(`${root}/proposals`, { shiftId: offeredId, startsAt: shift.startsAt, endsAt: shift.endsAt }));
    } else if (dialog.kind === 'accept' || dialog.kind === 'withdraw') {
      void mutate(() => saveExchange(`${root}/proposals/${encodeURIComponent(dialog.proposal.id)}/${dialog.kind}`));
    } else void mutate(() => saveExchange(`${root}/cancel`));
  }
  async function more() {
    if (!data?.nextCursor || saving.current) return;
    saving.current = true; setBusy(true); const generation = lifecycle.current;
    try {
      const next = await loadExchanges(new AbortController().signal, data.nextCursor);
      if (generation === lifecycle.current) setData(previous => previous ? { ...next, requests: [...previous.requests, ...next.requests.filter(r => !previous.requests.some(old => old.id === r.id))] } : next);
    } catch (cause) { if (generation === lifecycle.current) setError(cause instanceof Error ? cause.message : 'Could not load more swaps.'); }
    finally { saving.current = false; setBusy(false); }
  }
  function renderRequest(request: ExchangeRequest) {
    const own = request.requester.id === data!.currentUserId;
    const sent = hasOwnOpenOffer(request, data!.currentUserId);
    return <li key={request.id} id={`flyvask-exchange-${request.id}`} tabIndex={-1} className="exchange-row">
      <div className="exchange-row-heading"><strong>Looking for swap</strong>{!request.eligible && <span>No longer eligible</span>}</div>
      <p className="exchange-time">{shiftLabel(request.requestedShift)}</p>
      <p className="exchange-note">Offered by {own ? 'you' : userName(request.requester)}</p>
      <div className="exchange-actions">{own ? <button disabled={busy} onClick={() => open({ kind: 'cancel', request })}>Cancel request</button>
        : sent ? <span className="exchange-inline-status">Offer sent</span>
          : request.eligible && eligible.some(s => s.id !== request.requestedShift.id) && <button disabled={busy}
            onClick={() => open({ kind: 'propose', request })}>Offer one of my Flyvask shifts</button>}</div>
      {request.proposals.length > 0 && <ul className="exchange-proposals" aria-label="Swap offers">{request.proposals.map(proposal => <li key={proposal.id}>
        <strong>{userName(proposal.proposer)}</strong><p className="exchange-time">{shiftLabel(proposal.offeredShift)}</p>
        <span className="exchange-note">{!proposal.eligible ? 'No longer eligible' : 'Open offer'}</span>
        <div className="exchange-actions">{own ? request.eligible && proposal.eligible && <button disabled={busy} onClick={() => open({ kind: 'accept', request, proposal })}>Choose this swap</button>
          : proposal.proposer.id === data!.currentUserId && <button disabled={busy} onClick={() => open({ kind: 'withdraw', request, proposal })}>Withdraw offer</button>}</div>
      </li>)}</ul>}
    </li>;
  }
  const active = openRequests(data?.requests ?? []).map(r => ({ ...r, proposals: openProposals(r) }));
  const mine = active.filter(r => r.requester.id === data?.currentUserId || r.proposals.some(p => p.proposer.id === data?.currentUserId));
  const available = active.filter(r => r.eligible && r.requester.id !== data?.currentUserId && !mine.includes(r));
  const ownRequests = active.filter(r => r.requester.id === data?.currentUserId);
  const offersForYou = ownRequests.reduce((count, request) => count + request.proposals.length, 0);
  useEffect(() => {
    if (!showBoard || !data || !location.hash.startsWith('#flyvask-exchange-')) return;
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.focus();
  }, [data, location.hash, showBoard]);
  return <ExchangeContext.Provider value={{ enabled, busy: busy || loading, data, now, hasEligibleShift: eligible.length > 0, legacyOnly, open }}>{children}
    {enabled && !showBoard && (!legacyOnly || active.length > 0 || !!error) && <section className="exchange-overview" aria-labelledby="flyvask-exchange-overview"><h2 id="flyvask-exchange-overview">{legacyOnly ? 'Existing exchanges' : 'Exchanges'}</h2>
      {error && <p role="alert" className="duty-alert">{error}</p>}
      {data && !data.nextCursor && <p>Available {available.length} · Your requests {ownRequests.length} · Offers for you {offersForYou}</p>}
      <Link to="/flyvask/exchanges">View exchange center →</Link>
    </section>}
    {enabled && showBoard && (!legacyOnly || active.length > 0 || !!error || loading) && <section className="duty-exchanges" aria-label={legacyOnly ? 'Existing exchanges' : 'Exchanges'}>
      {legacyOnly && active.length > 0 && <h2>Existing exchanges</h2>}
      {loading && <p role="status" className="duty-loading">Loading swaps…</p>}
      {error && !dialog && <p role="alert" className="duty-alert">{error}</p>}
      {data && <>{available.length > 0 && <>{mine.length > 0 && <h3>Available</h3>}<ul>{available.map(renderRequest)}</ul></>}
        {mine.length > 0 && <>{available.length > 0 && <h3>Mine</h3>}<ul>{mine.map(renderRequest)}</ul></>}
        {!legacyOnly && !active.length && <p className="duty-empty">No open exchanges</p>}
        {data.nextCursor && <button disabled={busy} onClick={() => void more()}>Load more swaps</button>}</>}
    </section>}
    {dialog && <dialog ref={dialogRef} className={`exchange-dialog${dialog.kind === 'start' ? ' exchange-dialog-start' : ''}`} aria-labelledby="flyvask-dialog-title" onCancel={e => { e.preventDefault(); if (!busy) setDialog(null); }}>
      <h3 id="flyvask-dialog-title">{dialog.kind === 'start' ? 'Exchange shift' : dialog.kind === 'create' ? 'Post shift for swap' : dialog.kind === 'accept' ? 'Confirm swap' : dialog.kind === 'cancel' ? 'Cancel request?' : dialog.kind === 'withdraw' ? 'Withdraw offer?' : 'Offer one of my Flyvask shifts'}</h3>
      <form onSubmit={e => { e.preventDefault(); confirm(); }}>
        {dialog.kind === 'start' ? <ExchangeStart assignment={shiftLabel(dialog.shift)} busy={busy}
          opportunities={available.filter(request => request.requestedShift.id !== dialog.shift.id && !hasOwnOpenOffer(request, data!.currentUserId)).map(request => ({
            id: request.id, label: shiftLabel(request.requestedShift), person: userName(request.requester),
            onOffer: () => open({ kind: 'propose', request }, dialog.shift.id),
          }))} onPost={() => setDialog({ kind: 'create', shift: dialog.shift })} />
          : dialog.kind === 'create' ? <p className="exchange-time">{shiftLabel(dialog.shift)}</p>
          : dialog.kind === 'accept' ? <><p><strong>Your Flyvask</strong><br />{shiftLabel(dialog.request.requestedShift)}</p>
          <p><strong>{userName(dialog.proposal.proposer)}’s Flyvask</strong><br />{shiftLabel(dialog.proposal.offeredShift)}</p>
          <p className="exchange-note">Changes Studentportal assignments. FlightLogger is not updated automatically.</p></>
          : <><p className="exchange-time">{shiftLabel(dialog.kind === 'withdraw' ? dialog.proposal.offeredShift : dialog.request.requestedShift)}</p>
            {dialog.kind === 'propose' && <label className="exchange-select">Your Flyvask<select value={offeredId} onChange={e => setOfferedId(e.target.value)} disabled={busy} required>
              <option value="">Choose a shift</option>{eligible.filter(s => s.id !== dialog.request.requestedShift.id).map(s => <option key={s.id} value={s.id}>{shiftLabel(s)}</option>)}
            </select></label>}</>}
        {error && <p role="alert" className="duty-alert">{error}</p>}
        <div className="exchange-actions"><ActionButton variant="ghost" disabled={busy} onClick={() => setDialog(null)}>{dialog.kind === 'start' ? 'Close' : 'Cancel'}</ActionButton>
          {dialog.kind !== 'start' && <ActionButton variant="primary" type="submit" disabled={busy || (dialog.kind === 'propose' && !offeredId)}>{busy ? 'Saving…' : dialog.kind === 'create' ? 'Publish request' : dialog.kind === 'accept' ? 'Confirm swap' : dialog.kind === 'cancel' ? 'Cancel request' : dialog.kind === 'withdraw' ? 'Withdraw offer' : 'Offer shift'}</ActionButton>}
        </div>
      </form>
    </dialog>}
  </ExchangeContext.Provider>;
}
