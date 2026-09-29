import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useCurrentUser } from '../../app/CurrentUser';
import { PERMISSIONS } from '../../../../shared/authorization';
import { osloDate } from '../../dates';
import { shiftLabel, userName } from './exchange-presentation';
import { creditSign } from './credit-api';
import type { DutyShift } from './types';
import { loadExchanges, saveExchange, type ExchangeRequest, type ExchangeProposal, type ExchangesResponse } from './exchange-api';
import './exchanges.css';
import { ActionButton } from '../../app/controls';
import { Link, useLocation } from 'react-router';
import { ExchangeStart } from '../exchange/ExchangeStart';
import { hasOwnOpenOffer, openProposals, openRequests, ownOfferFor, ownRequestFor } from '../exchange/v1-presentation';
import { ExchangeV2AssignmentAction } from '../exchange/ExchangeV2';

type DialogState = { kind: 'start'; shift: DutyShift } | { kind: 'create'; shift: DutyShift; type: 'GIVE_AWAY' | 'DIRECT_SWAP' }
  | { kind: 'claim' | 'cancel' | 'propose'; request: ExchangeRequest }
  | { kind: 'accept' | 'withdraw'; request: ExchangeRequest; proposal: ExchangeProposal };
type Controls = { enabled: boolean; busy: boolean; data: ExchangesResponse | null; now: number; hasEligibleShift: boolean;
  legacyOnly: boolean; open: (dialog: DialogState, offeredId?: string) => void };
const ExchangeContext = createContext<Controls | null>(null);
export function ExchangeShiftActions({ shift }: { shift: DutyShift }) {
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
      return <div className="exchange-assignment-state"><span>{request.type === 'GIVE_AWAY' ? 'Give-away posted' : `Looking for swap${offers ? ` · ${offers} ${offers === 1 ? 'offer' : 'offers'}` : ''}`}</span>
        <ActionButton disabled={state.busy} onClick={() => state.open({ kind: 'cancel', request })}>Cancel</ActionButton>
        <Link to={`/duty-ops/exchanges#duty-exchange-${encodeURIComponent(request.id)}`}>{offers ? 'Review offers' : 'Open exchange'}</Link></div>;
    }
    const offer = ownOfferFor(requests, userId, shift.id, item => item.offeredShift.id);
    if (offer) return <div className="exchange-assignment-state"><span>Offer sent</span>
      <ActionButton disabled={state.busy} onClick={() => state.open({ kind: 'withdraw', ...offer })}>Withdraw offer</ActionButton>
      <Link to={`/duty-ops/exchanges#duty-exchange-${encodeURIComponent(offer.request.id)}`}>Open exchange</Link></div>;
    if (state.data?.lockedShiftIds.includes(shift.id)) return <div className="exchange-assignment-state"><span>Exchange active</span><Link to="/duty-ops/exchanges">Open exchange center</Link></div>;
    return state.legacyOnly ? <ExchangeV2AssignmentAction assignmentId={shift.id} /> :
      <ActionButton className="exchange-shift-action" disabled={state.busy || !state.data} onClick={() => state.open({ kind: 'start', shift })}>Exchange</ActionButton>;
  }
  const request = openRequests(requests).find(item => item.requestedShift.id === shift.id);
  if (!request) return state.legacyOnly ? <ExchangeV2AssignmentAction assignmentId={shift.id} /> : null;
  if (hasOwnOpenOffer(request, userId)) return <span className="exchange-inline-status">Offer sent</span>;
  return <div className="exchange-assignment-state"><span>{request.type === 'GIVE_AWAY' ? 'Give-away' : 'Swap wanted'}</span>
    {request.eligible && (request.type === 'GIVE_AWAY'
      ? <ActionButton disabled={state.busy} onClick={() => state.open({ kind: 'claim', request })}>Take shift</ActionButton>
      : state.hasEligibleShift && <ActionButton disabled={state.busy} onClick={() => state.open({ kind: 'propose', request })}>Offer your shift</ActionButton>)}</div>;
}

export function DutyExchanges({ children, afterBoard, shifts, now, refreshKey, onChanged, onBalanceChanged, showBoard = true, showOverview = false, legacyOnly = false }: { children: ReactNode; afterBoard?: ReactNode; shifts: DutyShift[]; now: number; refreshKey: number; onChanged?: () => void; onBalanceChanged?: (balance: number) => void; showBoard?: boolean; showOverview?: boolean; legacyOnly?: boolean }) {
  const { user } = useCurrentUser();
  const enabled = user?.permissions?.includes(PERMISSIONS.dutyOpsSwap) === true;
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
    setData(null); setError(''); setLoading(enabled);
    if (!enabled) setDialog(null);
    let pending = false;
    const update = async () => {
      if (!enabled || pending || saving.current) return;
      pending = true;
      await loadExchanges(controller.signal).then(value => { if (!controller.signal.aborted) { setData(value); setError(''); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load exchanges.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
      pending = false;
    };
    void update();
    const refreshVisible = () => { if (!document.hidden) void update(); };
    const timer = window.setInterval(refreshVisible, 60_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { controller.abort(); lifecycle.current++; window.clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); };
  }, [enabled, refreshKey, version, today]);
  useEffect(() => { if (data) onBalanceChanged?.(data.currentUserCreditBalance); }, [data, onBalanceChanged]);
  const balance = data?.currentUserCreditBalance;
  const atFloor = balance !== undefined && balance <= -2;
  useEffect(() => {
    if (dialog && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    if (!dialog && opener.current?.isConnected) { opener.current.focus(); opener.current = null; }
  }, [dialog]);
  const open = (next: DialogState, selectedShiftId = '') => { if (!dialog) opener.current = document.activeElement as HTMLElement; setError(''); setOfferedId(selectedShiftId); setDialog(next); };
  const eligible = shifts.filter(s => s.status === 'OPEN' && Date.parse(s.startsAt) > now && s.participants.some(p => p.isCurrentUser) && !data?.lockedShiftIds.includes(s.id));
  async function confirm() {
    if (!dialog || dialog.kind === 'start' || saving.current) return;
    saving.current = true; setBusy(true); setError(''); const generation = lifecycle.current;
    try {
      if (dialog.kind === 'create') {
        if (dialog.type === 'GIVE_AWAY' && atFloor) return;
        await saveExchange('', { type: dialog.type, shiftId: dialog.shift.id, startsAt: dialog.shift.startsAt, endsAt: dialog.shift.endsAt });
      } else {
        const root = `/${encodeURIComponent(dialog.request.id)}`;
        if (dialog.kind === 'propose') {
          const shift = eligible.find(s => s.id === offeredId); if (!shift) return;
          await saveExchange(`${root}/proposals`, { shiftId: offeredId, startsAt: shift.startsAt, endsAt: shift.endsAt });
        }
        else if (dialog.kind === 'accept' || dialog.kind === 'withdraw') await saveExchange(`${root}/proposals/${encodeURIComponent(dialog.proposal.id)}/${dialog.kind}`);
        else await saveExchange(`${root}/${dialog.kind}`);
      }
      if (generation === lifecycle.current) { setDialog(null); setVersion(v => v + 1); onChanged?.(); }
    } catch (cause) {
      if (generation === lifecycle.current) setError(cause instanceof Error ? cause.message : 'Could not save the exchange.');
    } finally { saving.current = false; setBusy(false); }
  }
  async function more() {
    if (!data?.nextCursor || saving.current) return;
    saving.current = true; setBusy(true); const generation = lifecycle.current;
    try {
      const next = await loadExchanges(new AbortController().signal, data.nextCursor);
      if (generation === lifecycle.current) setData(previous => previous ? { ...next, requests: [...previous.requests, ...next.requests.filter(r => !previous.requests.some(old => old.id === r.id))] } : next);
    } catch (cause) { if (generation === lifecycle.current) setError(cause instanceof Error ? cause.message : 'Could not load more exchanges.'); }
    finally { saving.current = false; setBusy(false); }
  }
  function renderRequest(request: ExchangeRequest) {
    const own = request.requester.id === data!.currentUserId;
    const sent = hasOwnOpenOffer(request, data!.currentUserId);
    return <li key={request.id} id={`duty-exchange-${request.id}`} tabIndex={-1} className="exchange-row">
      <div className="exchange-row-heading"><strong>{request.type === 'GIVE_AWAY' ? 'Give away' : 'Swap request'}</strong>
        {!request.eligible && <span>Currently unavailable</span>}</div>
      <p className="exchange-time">{shiftLabel(request.requestedShift)}</p>
      <p className="exchange-note">Offered by {own ? 'you' : userName(request.requester)}</p>
      {own && request.ineligibleReason === 'CREDIT_FLOOR' && <p className="exchange-note">Your balance must be above -2 before someone can take this shift. Cover another student’s shift to earn a credit.</p>}
      {request.status === 'OPEN' && <div className="exchange-actions">
        {own ? <button disabled={busy} onClick={() => open({ kind: 'cancel', request })}>Cancel request</button>
          : request.eligible && (request.type === 'GIVE_AWAY'
            ? <button disabled={busy} onClick={() => open({ kind: 'claim', request })}>Take shift</button>
            : sent ? <span className="exchange-inline-status">Offer sent</span>
              : eligible.some(s => s.id !== request.requestedShift.id) && <button disabled={busy}
                onClick={() => open({ kind: 'propose', request })}>Offer one of my shifts</button>)}
      </div>}
      {request.proposals.length > 0 && <ul className="exchange-proposals" aria-label="Swap offers">{request.proposals.map(proposal => <li key={proposal.id}>
        <strong>{userName(proposal.proposer)}</strong><p className="exchange-time">{shiftLabel(proposal.offeredShift)}</p>
        <span className="exchange-note">{proposal.status === 'NOT_SELECTED' ? 'Not selected' : proposal.status === 'WITHDRAWN' ? 'Withdrawn' : proposal.status === 'ACCEPTED' ? 'Accepted' : !proposal.eligible ? 'No longer eligible' : 'Open offer'}</span>
        {request.status === 'OPEN' && proposal.status === 'OPEN' && <div className="exchange-actions">
          {own ? request.eligible && proposal.eligible && <button disabled={busy} onClick={() => open({ kind: 'accept', request, proposal })}>Choose this swap</button>
            : proposal.proposer.id === data!.currentUserId && <button disabled={busy} onClick={() => open({ kind: 'withdraw', request, proposal })}>Withdraw offer</button>}
        </div>}
      </li>)}</ul>}
    </li>;
  }
  // Active work only, including when an old response is briefly retained.
  const active = openRequests(data?.requests ?? []).map(r => ({ ...r, proposals: openProposals(r) }));
  const mine = active.filter(r => r.requester.id === data?.currentUserId || r.proposals.some(p => p.proposer.id === data?.currentUserId));
  const available = active.filter(r => r.eligible && r.requester.id !== data?.currentUserId && !mine.includes(r));
  const ownRequests = active.filter(r => r.requester.id === data?.currentUserId);
  const offersForYou = ownRequests.reduce((count, request) => count + request.proposals.length, 0);
  useEffect(() => {
    if (!showBoard || !data || !location.hash.startsWith('#duty-exchange-')) return;
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    target?.focus();
  }, [data, location.hash, showBoard]);
  return <ExchangeContext.Provider value={{ enabled, busy: busy || loading, data, now, hasEligibleShift: eligible.length > 0, legacyOnly, open }}>{children}
    {enabled && showOverview && (!legacyOnly || active.length > 0 || !!error) && <section className="exchange-overview" aria-labelledby="exchange-overview-title"><h2 id="exchange-overview-title">{legacyOnly ? 'Existing exchanges' : 'Exchanges'}</h2>
      {error && <p role="alert" className="duty-alert">{error}</p>}
      {data && !data.nextCursor && <p>Available {available.length} · Your requests {ownRequests.length} · Offers for you {offersForYou}</p>}
      <Link to="/duty-ops/exchanges">View exchange center →</Link>
    </section>}
    {enabled && showBoard && (!legacyOnly || active.length > 0 || !!error || loading) && <section className="duty-exchanges" aria-label={legacyOnly ? 'Existing exchanges' : 'Exchanges'}>
      {legacyOnly && active.length > 0 && <h2>Existing exchanges</h2>}
      {loading && <p role="status" className="duty-loading">Loading exchanges…</p>}
      {error && !dialog && <p role="alert" className="duty-alert">{error}</p>}
      {data && <>{available.length > 0 && <>{mine.length > 0 && <h3>Available</h3>}<ul>{available.map(renderRequest)}</ul></>}
        {mine.length > 0 && <>{available.length > 0 && <h3>Mine</h3>}<ul>{mine.map(renderRequest)}</ul></>}
        {!legacyOnly && !active.length && <p className="duty-empty">No open exchanges</p>}
        {data.nextCursor && <button disabled={busy} onClick={() => void more()}>Load more exchanges</button>}
      </>}
    </section>}
    {afterBoard}
    {dialog && <dialog ref={dialogRef} className={`exchange-dialog${dialog.kind === 'start' ? ' exchange-dialog-start' : ''}`} aria-labelledby="exchange-dialog-title" onCancel={e => { e.preventDefault(); if (!busy) setDialog(null); }}>
      <h3 id="exchange-dialog-title">{dialog.kind === 'start' ? 'Exchange shift' : dialog.kind === 'create' ? dialog.type === 'GIVE_AWAY' ? 'Give away shift' : 'Post shift for swap' : dialog.kind === 'accept' ? 'Confirm exchange' : dialog.kind === 'claim' ? 'Take this Duty Ops shift?' : dialog.kind === 'cancel' ? 'Cancel request?' : dialog.kind === 'withdraw' ? 'Withdraw offer?' : 'Offer one of my shifts'}</h3>
      <form onSubmit={e => { e.preventDefault(); void confirm(); }}>
        {dialog.kind === 'start' ? <ExchangeStart assignment={shiftLabel(dialog.shift)} busy={busy}
          opportunities={available.filter(request => request.type === 'DIRECT_SWAP' && request.requestedShift.id !== dialog.shift.id && !hasOwnOpenOffer(request, data!.currentUserId)).map(request => ({
            id: request.id, label: shiftLabel(request.requestedShift), person: userName(request.requester),
            onOffer: () => open({ kind: 'propose', request }, dialog.shift.id),
          }))}
          onPost={() => setDialog({ kind: 'create', shift: dialog.shift, type: 'DIRECT_SWAP' })}
          onGiveAway={atFloor ? undefined : () => setDialog({ kind: 'create', shift: dialog.shift, type: 'GIVE_AWAY' })} />
          : dialog.kind === 'create' ? <><p className="exchange-time">{shiftLabel(dialog.shift)}</p><div className="exchange-decision-note">
            {dialog.type === 'GIVE_AWAY' ? <><p className="exchange-note">Your current balance: {creditSign(balance!)} · After this shift is taken: {creditSign(balance! - 1)}</p><p className="exchange-note">Another student can take the shift without further confirmation.</p></>
              : <p className="exchange-note">Others can offer one of their shifts.</p>}</div></>
          : dialog.kind === 'accept' ? <><p><strong>Your shift</strong><br />{shiftLabel(dialog.request.requestedShift)}</p>
            <p><strong>{userName(dialog.proposal.proposer)}’s shift</strong><br />{shiftLabel(dialog.proposal.offeredShift)}</p>
            <p className="exchange-note">Agreed in Studentportal. FlightLogger is not updated automatically.</p></>
          : <><p className="exchange-time">{shiftLabel(dialog.kind === 'withdraw' ? dialog.proposal.offeredShift : dialog.request.requestedShift)}</p>
            {dialog.kind === 'claim' && <p className="exchange-note">Taking this shift earns you 1 credit: {creditSign(balance!)} → {creditSign(balance! + 1)}.</p>}
            {dialog.kind === 'propose' && <label className="exchange-select">Your shift<select value={offeredId} onChange={e => setOfferedId(e.target.value)} disabled={busy} required>
              <option value="">Choose a shift</option>{eligible.filter(s => s.id !== dialog.request.requestedShift.id).map(s => <option key={s.id} value={s.id}>{shiftLabel(s)}</option>)}
            </select></label>}</>}
        {error && <p role="alert" className="duty-alert">{error}</p>}
        <div className="exchange-actions"><ActionButton variant="ghost" disabled={busy} onClick={() => setDialog(null)}>{dialog.kind === 'start' ? 'Close' : 'Cancel'}</ActionButton>
          {dialog.kind !== 'start' && <ActionButton variant="primary" type="submit" disabled={busy || (dialog.kind === 'create' && dialog.type === 'GIVE_AWAY' && atFloor) || (dialog.kind === 'propose' && !offeredId)}>
            {busy ? 'Saving…' : dialog.kind === 'create' ? 'Publish request' : dialog.kind === 'accept' ? 'Confirm exchange' : dialog.kind === 'claim' ? 'Take shift' : dialog.kind === 'cancel' ? 'Cancel request' : dialog.kind === 'withdraw' ? 'Withdraw offer' : 'Offer shift'}
          </ActionButton>}</div>
      </form>
    </dialog>}
  </ExchangeContext.Provider>;
}
