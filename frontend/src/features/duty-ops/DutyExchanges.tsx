import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useCurrentUser } from '../../app/CurrentUser';
import { PERMISSIONS } from '../../../../shared/authorization';
import { osloDate } from '../../dates';
import { shiftLabel, userName } from './exchange-presentation';
import { creditSign } from './credit-api';
import type { DutyShift } from './types';
import { loadExchanges, saveExchange, type ExchangeRequest, type ExchangeProposal, type ExchangesResponse } from './exchange-api';
import './exchanges.css';

type DialogState = { kind: 'create'; shift: DutyShift; type?: 'GIVE_AWAY' | 'DIRECT_SWAP' }
  | { kind: 'claim' | 'cancel' | 'propose'; request: ExchangeRequest }
  | { kind: 'accept' | 'withdraw'; request: ExchangeRequest; proposal: ExchangeProposal };
type Controls = { enabled: boolean; busy: boolean; data: ExchangesResponse | null; now: number; open: (dialog: DialogState) => void };
const ExchangeContext = createContext<Controls | null>(null);
export function ExchangeShiftActions({ shift }: { shift: DutyShift }) {
  const state = useContext(ExchangeContext);
  if (!state?.enabled || shift.status !== 'OPEN' || Date.parse(shift.startsAt) <= state.now || !shift.participants.some(p => p.isCurrentUser)) return null;
  if (state.data?.lockedShiftIds.includes(shift.id)) return <p className="exchange-note">Shift has an active exchange</p>;
  return <button className="exchange-shift-action" disabled={state.busy || !state.data} onClick={() => state.open({ kind: 'create', shift })}>Exchange shift</button>;
}

export function DutyExchanges({ children, shifts, now, refreshKey, onChanged, onBalanceChanged }: { children: ReactNode; shifts: DutyShift[]; now: number; refreshKey: number; onChanged?: () => void; onBalanceChanged?: (balance: number) => void }) {
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
  const saving = useRef(false);
  const lifecycle = useRef(0);
  const today = osloDate(new Date(now));
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
  }, [dialog]);
  const open = (next: DialogState) => { setError(''); setOfferedId(''); setDialog(next); };
  const eligible = shifts.filter(s => s.status === 'OPEN' && Date.parse(s.startsAt) > now && s.participants.some(p => p.isCurrentUser) && !data?.lockedShiftIds.includes(s.id));
  async function confirm() {
    if (!dialog || saving.current) return;
    saving.current = true; setBusy(true); setError(''); const generation = lifecycle.current;
    try {
      if (dialog.kind === 'create') {
        if (!dialog.type || (dialog.type === 'GIVE_AWAY' && atFloor)) return;
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
    return <li key={request.id} className="exchange-row">
      <div className="exchange-row-heading"><strong>{request.type === 'GIVE_AWAY' ? 'Give away' : 'Swap request'}</strong>
        <span>{!request.eligible ? 'Currently unavailable' : 'Open'}</span></div>
      <p className="exchange-time">{shiftLabel(request.requestedShift)}</p>
      <p className="exchange-note">Offered by {own ? 'you' : userName(request.requester)}</p>
      {own && request.ineligibleReason === 'CREDIT_FLOOR' && <p className="exchange-note">Your balance must be above -2 before someone can take this shift. Cover another student’s shift to earn a credit.</p>}
      {request.status === 'OPEN' && <div className="exchange-actions">
        {own ? <button disabled={busy} onClick={() => open({ kind: 'cancel', request })}>Cancel request</button>
          : request.eligible && (request.type === 'GIVE_AWAY'
            ? <button disabled={busy} onClick={() => open({ kind: 'claim', request })}>Take shift</button>
            : <button disabled={busy || !eligible.some(s => s.id !== request.requestedShift.id) || request.proposals.some(p => p.status === 'OPEN')}
                onClick={() => open({ kind: 'propose', request })}>Offer one of my shifts</button>)}
      </div>}
      {request.proposals.length > 0 && <ul className="exchange-proposals" aria-label="Swap offers">{request.proposals.map(proposal => <li key={proposal.id}>
        <strong>{userName(proposal.proposer)}</strong><p className="exchange-time">{shiftLabel(proposal.offeredShift)}</p>
        <span className="exchange-note">{proposal.status === 'NOT_SELECTED' ? 'Not selected' : proposal.status === 'WITHDRAWN' ? 'Withdrawn' : proposal.status === 'ACCEPTED' ? 'Accepted' : !proposal.eligible ? 'No longer eligible' : 'Open offer'}</span>
        {request.status === 'OPEN' && proposal.status === 'OPEN' && <div className="exchange-actions">
          {own ? <button disabled={busy || !request.eligible || !proposal.eligible} onClick={() => open({ kind: 'accept', request, proposal })}>Choose this swap</button>
            : proposal.proposer.id === data!.currentUserId && <button disabled={busy} onClick={() => open({ kind: 'withdraw', request, proposal })}>Withdraw offer</button>}
        </div>}
      </li>)}</ul>}
    </li>;
  }
  // Active work only, including when an old response is briefly retained.
  const active = data?.requests.filter(r => r.status === 'OPEN').map(r => ({ ...r, proposals: r.proposals.filter(p => p.status === 'OPEN') })) ?? [];
  const mine = active.filter(r => r.requester.id === data?.currentUserId || r.proposals.some(p => p.proposer.id === data?.currentUserId));
  const available = active.filter(r => r.eligible && r.requester.id !== data?.currentUserId && !mine.includes(r));
  return <ExchangeContext.Provider value={{ enabled, busy: busy || loading, data, now, open }}>{children}
    {enabled && <section className="duty-exchanges" aria-labelledby="exchange-title"><h2 id="exchange-title">Shift exchange</h2>
      {loading && <p role="status" className="duty-loading">Loading exchanges…</p>}
      {error && !dialog && <p role="alert" className="duty-alert">{error}</p>}
      {data && <><h3>Available exchanges</h3>{available.length ? <ul>{available.map(renderRequest)}</ul> : <p className="duty-empty">No open exchanges</p>}
        <h3>My exchanges</h3>{mine.length ? <ul>{mine.map(renderRequest)}</ul> : <p className="duty-empty">No exchanges yet</p>}
        {data.nextCursor && <button disabled={busy} onClick={() => void more()}>Load more exchanges</button>}
      </>}
    </section>}
    {dialog && <dialog ref={dialogRef} className="exchange-dialog" aria-labelledby="exchange-dialog-title" onCancel={e => { e.preventDefault(); if (!busy) setDialog(null); }}>
      <h3 id="exchange-dialog-title">{dialog.kind === 'create' ? 'Exchange shift' : dialog.kind === 'accept' ? 'Confirm exchange' : dialog.kind === 'claim' ? 'Take this Duty Ops shift?' : dialog.kind === 'cancel' ? 'Cancel request?' : dialog.kind === 'withdraw' ? 'Withdraw offer?' : 'Offer one of my shifts'}</h3>
      <form onSubmit={e => { e.preventDefault(); void confirm(); }}>
        {dialog.kind === 'create' ? <><p className="exchange-time">{shiftLabel(dialog.shift)}</p><div className="exchange-choices">
          <label><input type="radio" name="exchange-type" checked={dialog.type === 'GIVE_AWAY'} onChange={() => setDialog({ ...dialog, type: 'GIVE_AWAY' })} disabled={busy || atFloor} />Give away</label>
          <label><input type="radio" name="exchange-type" checked={dialog.type === 'DIRECT_SWAP'} onChange={() => setDialog({ ...dialog, type: 'DIRECT_SWAP' })} disabled={busy} />Look for swap</label>
        </div>{atFloor && <p className="exchange-note">Your balance is {creditSign(balance!)}. Cover another student’s shift to earn a credit before giving away a shift. Your balance must be above -2. Direct swaps remain available.</p>}
        {dialog.type === 'GIVE_AWAY' && <><p className="exchange-note">Publishing lets another student take this shift without another confirmation from you.</p><p className="exchange-note">When someone takes your shift, you spend 1 credit: {creditSign(balance!)} → {creditSign(balance! - 1)}.</p></>}</>
          : dialog.kind === 'accept' ? <><p><strong>Your shift</strong><br />{shiftLabel(dialog.request.requestedShift)}</p>
            <p><strong>{userName(dialog.proposal.proposer)}’s shift</strong><br />{shiftLabel(dialog.proposal.offeredShift)}</p>
            <p className="exchange-note">Agreed in Studentportal. FlightLogger is not updated automatically.</p></>
          : <><p className="exchange-time">{shiftLabel(dialog.kind === 'withdraw' ? dialog.proposal.offeredShift : dialog.request.requestedShift)}</p>
            {dialog.kind === 'claim' && <p className="exchange-note">Taking this shift earns you 1 credit: {creditSign(balance!)} → {creditSign(balance! + 1)}.</p>}
            {dialog.kind === 'propose' && <label className="exchange-select">Your shift<select value={offeredId} onChange={e => setOfferedId(e.target.value)} disabled={busy} required>
              <option value="">Choose a shift</option>{eligible.filter(s => s.id !== dialog.request.requestedShift.id).map(s => <option key={s.id} value={s.id}>{shiftLabel(s)}</option>)}
            </select></label>}</>}
        {error && <p role="alert" className="duty-alert">{error}</p>}
        <div className="exchange-actions"><button type="button" disabled={busy} onClick={() => setDialog(null)}>Back</button>
          <button type="submit" disabled={busy || (dialog.kind === 'create' && (!dialog.type || (dialog.type === 'GIVE_AWAY' && atFloor))) || (dialog.kind === 'propose' && !offeredId)}>
            {busy ? 'Saving…' : dialog.kind === 'create' ? 'Publish request' : dialog.kind === 'accept' ? 'Confirm exchange' : dialog.kind === 'claim' ? 'Take shift' : dialog.kind === 'cancel' ? 'Cancel request' : dialog.kind === 'withdraw' ? 'Withdraw offer' : 'Offer shift'}
          </button></div>
      </form>
    </dialog>}
  </ExchangeContext.Provider>;
}
