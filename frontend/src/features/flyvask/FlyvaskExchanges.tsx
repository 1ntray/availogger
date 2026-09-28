import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useCurrentUser } from '../../app/CurrentUser';
import { PERMISSIONS } from '../../../../shared/authorization';
import { osloDate } from '../../dates';
import { shiftLabel, userName } from './exchange-presentation';
import type { FlyvaskShift } from './types';
import { loadExchanges, saveExchange, type ExchangeRequest, type ExchangeProposal, type ExchangesResponse } from './exchange-api';
import '../duty-ops/exchanges.css';

type DialogState = { kind: 'cancel' | 'propose'; request: ExchangeRequest }
  | { kind: 'accept' | 'withdraw'; request: ExchangeRequest; proposal: ExchangeProposal };
type Controls = { enabled: boolean; busy: boolean; data: ExchangesResponse | null; now: number; publish: (shift: FlyvaskShift) => void };
const ExchangeContext = createContext<Controls | null>(null);
export function ExchangeShiftActions({ shift }: { shift: FlyvaskShift }) {
  const state = useContext(ExchangeContext);
  if (!state?.enabled || shift.status !== 'OPEN' || Date.parse(shift.startsAt) <= state.now || !shift.participants.some(p => p.isCurrentUser)) return null;
  if (state.data?.lockedShiftIds.includes(shift.id)) return <p className="exchange-note">Shift has an active swap</p>;
  return <button className="exchange-shift-action" disabled={state.busy || !state.data} onClick={() => state.publish(shift)}>Look for swap</button>;
}

export function FlyvaskExchanges({ children, shifts, now, refreshKey, onChanged }: { children: ReactNode; shifts: FlyvaskShift[]; now: number; refreshKey: number; onChanged?: () => void }) {
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
  const open = (next: DialogState) => { opener.current = document.activeElement as HTMLElement; setError(''); setOfferedId(''); setDialog(next); };
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
  const publish = (shift: FlyvaskShift) => { void mutate(() => saveExchange('', { shiftId: shift.id, startsAt: shift.startsAt, endsAt: shift.endsAt })); };
  function confirm() {
    if (!dialog) return;
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
    return <li key={request.id} className="exchange-row">
      <div className="exchange-row-heading"><strong>Looking for swap</strong><span>{!request.eligible ? 'No longer eligible' : 'Open'}</span></div>
      <p className="exchange-time">{shiftLabel(request.requestedShift)}</p>
      <p className="exchange-note">Offered by {own ? 'you' : userName(request.requester)}</p>
      <div className="exchange-actions">{own ? <button disabled={busy} onClick={() => open({ kind: 'cancel', request })}>Cancel request</button>
        : request.eligible && <button disabled={busy || !eligible.some(s => s.id !== request.requestedShift.id) || request.proposals.length > 0}
            onClick={() => open({ kind: 'propose', request })}>Offer one of my Flyvask shifts</button>}</div>
      {request.proposals.length > 0 && <ul className="exchange-proposals" aria-label="Swap offers">{request.proposals.map(proposal => <li key={proposal.id}>
        <strong>{userName(proposal.proposer)}</strong><p className="exchange-time">{shiftLabel(proposal.offeredShift)}</p>
        <span className="exchange-note">{!proposal.eligible ? 'No longer eligible' : 'Open offer'}</span>
        <div className="exchange-actions">{own ? <button disabled={busy || !request.eligible || !proposal.eligible} onClick={() => open({ kind: 'accept', request, proposal })}>Choose this swap</button>
          : proposal.proposer.id === data!.currentUserId && <button disabled={busy} onClick={() => open({ kind: 'withdraw', request, proposal })}>Withdraw offer</button>}</div>
      </li>)}</ul>}
    </li>;
  }
  const active = data?.requests.filter(r => r.status === 'OPEN').map(r => ({ ...r, proposals: r.proposals.filter(p => p.status === 'OPEN') })) ?? [];
  const mine = active.filter(r => r.requester.id === data?.currentUserId || r.proposals.some(p => p.proposer.id === data?.currentUserId));
  const available = active.filter(r => r.eligible && r.requester.id !== data?.currentUserId && !mine.includes(r));
  return <ExchangeContext.Provider value={{ enabled, busy: busy || loading, data, now, publish }}>{children}
    {enabled && <section className="duty-exchanges" aria-labelledby="flyvask-exchange-title"><h2 id="flyvask-exchange-title">Shift exchange</h2>
      {loading && <p role="status" className="duty-loading">Loading swaps…</p>}
      {error && !dialog && <p role="alert" className="duty-alert">{error}</p>}
      {data && <><h3>Available swaps</h3>{available.length ? <ul>{available.map(renderRequest)}</ul> : <p className="duty-empty">No open swaps</p>}
        <h3>My swaps</h3>{mine.length ? <ul>{mine.map(renderRequest)}</ul> : <p className="duty-empty">No active swaps</p>}
        {data.nextCursor && <button disabled={busy} onClick={() => void more()}>Load more swaps</button>}</>}
    </section>}
    {dialog && <dialog ref={dialogRef} className="exchange-dialog" aria-labelledby="flyvask-dialog-title" onCancel={e => { e.preventDefault(); if (!busy) setDialog(null); }}>
      <h3 id="flyvask-dialog-title">{dialog.kind === 'accept' ? 'Confirm swap' : dialog.kind === 'cancel' ? 'Cancel request?' : dialog.kind === 'withdraw' ? 'Withdraw offer?' : 'Offer one of my Flyvask shifts'}</h3>
      <form onSubmit={e => { e.preventDefault(); confirm(); }}>
        {dialog.kind === 'accept' ? <><p><strong>Your Flyvask</strong><br />{shiftLabel(dialog.request.requestedShift)}</p>
          <p><strong>{userName(dialog.proposal.proposer)}’s Flyvask</strong><br />{shiftLabel(dialog.proposal.offeredShift)}</p>
          <p className="exchange-note">Changes Studentportal assignments. FlightLogger is not updated automatically.</p></>
          : <><p className="exchange-time">{shiftLabel(dialog.kind === 'withdraw' ? dialog.proposal.offeredShift : dialog.request.requestedShift)}</p>
            {dialog.kind === 'propose' && <label className="exchange-select">Your Flyvask<select value={offeredId} onChange={e => setOfferedId(e.target.value)} disabled={busy} required>
              <option value="">Choose a shift</option>{eligible.filter(s => s.id !== dialog.request.requestedShift.id).map(s => <option key={s.id} value={s.id}>{shiftLabel(s)}</option>)}
            </select></label>}</>}
        {error && <p role="alert" className="duty-alert">{error}</p>}
        <div className="exchange-actions"><button type="button" disabled={busy} onClick={() => setDialog(null)}>Back</button>
          <button type="submit" disabled={busy || (dialog.kind === 'propose' && !offeredId)}>{busy ? 'Saving…' : dialog.kind === 'accept' ? 'Confirm swap' : dialog.kind === 'cancel' ? 'Cancel request' : dialog.kind === 'withdraw' ? 'Withdraw offer' : 'Offer shift'}</button>
        </div>
      </form>
    </dialog>}
  </ExchangeContext.Provider>;
}
