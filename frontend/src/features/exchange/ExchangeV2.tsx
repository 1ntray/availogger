import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useCurrentUser } from '../../app/CurrentUser';
import { ActionButton, ContextLink } from '../../app/controls';
import { PERMISSIONS } from '../../../../shared/authorization';
import { displayName } from '../../../../shared/display-name';
import type { AssignmentActionState, ExchangeAssignmentSnapshot, ExchangeDomain, ExchangeV2Candidate,
  ExchangeV2Intent, ExchangeV2StateResponse } from '../../../../shared/exchange-v2';
import { compactWeekTitle } from '../brakkevakt/presentation';
import { creditSign, loadCreditSummary } from '../duty-ops/credit-api';
import { exchangeV2, loadExchangeV2 } from './v2-api';
import { useLegacyOpportunities } from './legacy-preview';
import { compactSwapperNames } from './presentation';
import './exchange-v2.css';

export type ExchangeAssignment = { id: string; label: string; ownerNames: string; own: boolean };
type CreateDialog = { kind: 'create'; sourceId: string };
type TargetDialog = { kind: 'target'; targetId: string; sourceId: string };
type ActionName = 'cancel' | 'claim' | 'accept' | 'offer' | 'withdraw' | 'confirm' | 'decline';
type ActionDialog = { kind: 'action'; action: ActionName; id: string; assignmentId: string;
  offerSourceIds?: string[]; returnTo?: CreateDialog };
type Dialog = CreateDialog | TargetDialog | ActionDialog;
type ExchangeContextValue = {
  domain: ExchangeDomain; enabled: boolean; data: ExchangeV2StateResponse | null; assignments: ExchangeAssignment[];
  busy: boolean; loading: boolean; error: string; state: (id: string) => AssignmentActionState | undefined;
  open: (next: Dialog) => void; browseSource: string | null; selectedTargets: string[];
  setSelectedTargets: (targets: string[]) => void; finishBrowse: () => void; beginBrowse: (sourceId: string) => void;
};
const ExchangeContext = createContext<ExchangeContextValue | null>(null);
export function useExchangeV2() { return useContext(ExchangeContext); }
const path: Record<ExchangeDomain, string> = { DUTY_OPS: '/duty-ops', FLYVASK: '/flyvask', BRAKKEVAKT: '/brakkevakt' };
const swapPermission = { DUTY_OPS: PERMISSIONS.dutyOpsSwap, FLYVASK: PERMISSIONS.flyvaskSwap,
  BRAKKEVAKT: PERMISSIONS.brakkevaktSwap } as const;
const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', weekday: 'short', day: 'numeric', month: 'short' });
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function exchangeAssignmentLabel(assignment: ExchangeAssignmentSnapshot): string {
  if (assignment.weekStart) return compactWeekTitle(assignment.weekStart);
  return `${date.format(new Date(assignment.startsAt))} · ${clock.format(new Date(assignment.startsAt))}–${clock.format(new Date(assignment.endsAt))}`;
}
const activeIntent = (intent: ExchangeV2Intent) => intent.status === 'OPEN';
const activeCandidate = (candidate: ExchangeV2Candidate) => candidate.status === 'WAITING';
const actorLeg = (candidate: ExchangeV2Candidate, userId: string) => candidate.legs.find(leg => leg.user.id === userId);
function intentOwners(data: ExchangeV2StateResponse, assignmentId: string): string {
  return compactSwapperNames(data.intents.filter(item => activeIntent(item) && item.source.id === assignmentId)
    .map(item => displayName(item.owner)));
}

export function ExchangeV2Provider({ domain, assignments, refreshKey, onChanged, children }: {
  domain: ExchangeDomain; assignments: ExchangeAssignment[]; refreshKey: number; onChanged: () => void; children: ReactNode;
}) {
  const { user } = useCurrentUser();
  const enabled = user?.permissions.includes(swapPermission[domain]) === true;
  const [data, setData] = useState<ExchangeV2StateResponse | null>(null);
  const [loading, setLoading] = useState(enabled), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [version, setVersion] = useState(0), [dialog, setDialog] = useState<Dialog | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]), [browseSource, setBrowseSource] = useState<string | null>(null);
  const [allowGiveAway, setAllowGiveAway] = useState(false), [balance, setBalance] = useState<number | null>(null);
  const [selectedSource, setSelectedSource] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null), opener = useRef<HTMLElement | null>(null), saving = useRef(false);
  const idsKey = assignments.map(item => item.id).join(',');
  const stateMap = useMemo(() => new Map(data?.assignmentStates.map(item => [item.assignmentId, item]) ?? []), [data]);
  const state = (id: string) => stateMap.get(id);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setLoading(enabled);
    if (!enabled) setData(null);
    if (enabled) void loadExchangeV2(domain, idsKey ? idsKey.split(',') : [], controller.signal)
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load exchanges.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [domain, enabled, idsKey, refreshKey, version]);
  useEffect(() => {
    if (dialog && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    if (!dialog && !browseSource && opener.current) { if (opener.current.isConnected) opener.current.focus(); opener.current = null; }
  }, [dialog, browseSource]);
  useEffect(() => {
    if (dialog?.kind !== 'create' || domain !== 'DUTY_OPS') return;
    const controller = new AbortController(); setBalance(null);
    void loadCreditSummary(controller.signal).then(summary => { if (!controller.signal.aborted) setBalance(summary.balance); })
      .catch(() => { if (!controller.signal.aborted) setBalance(null); });
    return () => controller.abort();
  }, [dialog?.kind, domain]);
  useEffect(() => { if (browseSource) document.getElementById('exchange-schedule')?.scrollIntoView({ block: 'start' }); }, [browseSource]);
  function open(next: Dialog) {
    if (!dialog && !browseSource) opener.current = document.activeElement as HTMLElement;
    setError('');
    if (next.kind === 'create' && dialog?.kind !== 'create' && !browseSource) { setSelectedTargets([]); setAllowGiveAway(false); }
    if (next.kind === 'target') setSelectedSource(next.sourceId);
    setDialog(next);
  }
  function close() { setDialog(null); setBrowseSource(null); setError(''); }
  function beginBrowse(sourceId: string) { setBrowseSource(sourceId); setDialog(null); }
  function finishBrowse() { const sourceId = browseSource; if (!sourceId) return; setBrowseSource(null); setDialog({ kind: 'create', sourceId }); }
  async function mutate(operation: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try { await operation(); setDialog(null); setBrowseSource(null); setVersion(value => value + 1); onChanged(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Exchange changed. Refresh and try again.');
      setVersion(value => value + 1); onChanged();
    }
    finally { saving.current = false; setBusy(false); }
  }
  function submit() {
    if (!dialog || !data) return;
    if (dialog.kind === 'create') {
      const sourceState = state(dialog.sourceId);
      if (!sourceState?.availableActions.includes('OPEN_EXCHANGE')) return;
      if (selectedTargets.some(id => !state(id)?.requestableSourceAssignmentIds.includes(dialog.sourceId))) {
        setError('A selected assignment changed. Review your choices and try again.'); return;
      }
      void mutate(() => exchangeV2.createIntent(domain, dialog.sourceId, selectedTargets, domain === 'DUTY_OPS' && allowGiveAway));
    } else if (dialog.kind === 'target') {
      const targetState = state(dialog.targetId);
      if (!targetState?.availableActions.includes('REQUEST_SWAP') || !targetState.requestableSourceAssignmentIds.includes(selectedSource)) return;
      void mutate(() => exchangeV2.createIntent(domain, selectedSource, [dialog.targetId], false));
    } else {
      const { action, id, assignmentId } = dialog;
      const assignmentState = state(assignmentId);
      const required = { cancel: 'CANCEL_INTENT', claim: 'TAKE_GIVE_AWAY', accept: 'ACCEPT_TARGET', offer: 'OFFER_SHIFT',
        withdraw: 'WITHDRAW_OFFER', confirm: 'CONFIRM_CANDIDATE', decline: 'DECLINE_CANDIDATE' } as const;
      if (!assignmentState?.availableActions.includes(required[action])) return;
      void mutate(() => action === 'cancel' ? exchangeV2.cancelIntent(id) : action === 'claim' ? exchangeV2.claimGiveAway(id) :
        action === 'accept' ? exchangeV2.acceptTarget(id) : action === 'offer' ? exchangeV2.createOffer(id, assignmentId) :
        action === 'withdraw' ? exchangeV2.withdrawOffer(id) : action === 'confirm' ? exchangeV2.confirmCandidate(id) :
        exchangeV2.declineCandidate(id));
    }
  }
  const context: ExchangeContextValue = { domain, enabled, data, assignments, busy, loading, error, state, open,
    browseSource, selectedTargets, setSelectedTargets, beginBrowse, finishBrowse };
  const dialogLabel = dialog?.kind === 'create' ? 'Exchange assignment' : dialog?.kind === 'target' ? 'Request swap' :
    dialog?.action === 'confirm' || dialog?.action === 'decline' ? 'Review exchange' :
    dialog?.action === 'accept' ? 'Accept request' : dialog?.action === 'offer' ? 'Offer assignment' :
    dialog?.action === 'claim' ? 'Take assignment' : dialog?.action === 'withdraw' ? 'Withdraw offer' :
    'Cancel exchange';
  const active = data?.intents.filter(activeIntent) ?? [];
  const sourceLabel = (id: string) => {
    const descriptor = assignments.find(item => item.id === id);
    const snapshot = active.find(item => item.source.id === id)?.source ??
      data?.assignmentStates.flatMap(item => item.requestableSourceAssignments).find(item => item.id === id);
    return descriptor?.label ?? (snapshot ? exchangeAssignmentLabel(snapshot) : id);
  };
  const createSource = dialog?.kind === 'create' ? dialog.sourceId : null;
  const choices = createSource ? assignments.filter(item => !item.own && state(item.id)?.requestableSourceAssignmentIds.includes(createSource)) : [];
  const existingChoices = choices.filter(item => active.some(intent => intent.source.id === item.id));
  const browsedChoices = choices.filter(item => selectedTargets.includes(item.id) && !existingChoices.some(existing => existing.id === item.id));
  const actionIntent = dialog?.kind === 'action' ? data?.intents.find(item => item.id === dialog.id) : undefined;
  const actionCandidate = dialog?.kind === 'action' ? data?.candidates.find(item => item.id === dialog.id) : undefined;
  const leg = actionCandidate && data ? actorLeg(actionCandidate, data.currentUserId) : undefined;
  const actionTarget = dialog?.kind === 'action' ? active.flatMap(intent => intent.targets.map(target => ({ intent, target })))
    .find(item => item.target.id === dialog.id) : undefined;
  return <ExchangeContext.Provider value={context}>{children}
    {browseSource && <div className="exchange-browse-bar" role="status"><span>{selectedTargets.length} selected</span>
      <ActionButton onClick={finishBrowse}>Done</ActionButton><ActionButton variant="ghost" onClick={close}>Cancel</ActionButton></div>}
    {dialog && <dialog ref={dialogRef} className="exchange-dialog exchange-v2-dialog" aria-labelledby="exchange-v2-dialog-title"
      onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
      <h3 id="exchange-v2-dialog-title">{dialogLabel}</h3>
      <form onSubmit={event => { event.preventDefault(); submit(); }}>
        {dialog.kind === 'create' && <>
          <p className="exchange-start-assignment"><strong>Your assignment</strong><br />{sourceLabel(dialog.sourceId)}</p>
          <h4>Available exchanges</h4>
          {existingChoices.length ? <div className="exchange-v2-choices">{existingChoices.map(item =>
            <label key={item.id}><input type="checkbox" checked={selectedTargets.includes(item.id)}
              onChange={() => setSelectedTargets(selectedTargets.includes(item.id) ? selectedTargets.filter(id => id !== item.id) : [...selectedTargets, item.id])}
              disabled={busy || (!selectedTargets.includes(item.id) && selectedTargets.length >= 10)} />
              <span><strong>{item.label}</strong><small>{item.ownerNames} wants to exchange</small></span></label>)}</div>
            : <p className="exchange-note">No open exchanges nearby</p>}
          <ActionButton variant="secondary" onClick={() => beginBrowse(dialog.sourceId)}>Browse schedule</ActionButton>
          {browsedChoices.length > 0 && <><h4>Selected from schedule</h4><div className="exchange-v2-choices">{browsedChoices.map(item =>
            <label key={item.id}><input type="checkbox" checked onChange={() => setSelectedTargets(selectedTargets.filter(id => id !== item.id))}
              disabled={busy} /><span><strong>{item.label}</strong><small>{item.ownerNames}</small></span></label>)}</div></>}
          {!!selectedTargets.length && <p className="exchange-note">{selectedTargets.length} selected target{selectedTargets.length === 1 ? '' : 's'}</p>}
          {domain === 'DUTY_OPS' && <label className="exchange-v2-give"><input type="checkbox" checked={allowGiveAway}
            onChange={event => setAllowGiveAway(event.target.checked)} disabled={busy || balance === null || balance <= -2} />
            <span>Also allow someone to take my shift{balance !== null && <small>Balance now: {creditSign(balance)} · After give-away: {creditSign(balance - 1)}</small>}</span></label>}
          <p className="exchange-note">You can still receive other swap offers.</p>
        </>}
        {dialog.kind === 'target' && <>
          <p><strong>You want</strong><br />{sourceLabel(dialog.targetId)}</p>
          <fieldset className="exchange-v2-sources"><legend>{state(dialog.targetId)?.requestableSourceAssignmentIds.length === 1 ? 'You give' : 'Which assignment would you exchange?'}</legend>
            {state(dialog.targetId)?.requestableSourceAssignmentIds.map(id => <label key={id}><input type="radio" name="exchange-source" value={id}
              checked={selectedSource === id} onChange={() => setSelectedSource(id)} />{sourceLabel(id)}</label>)}</fieldset>
        </>}
        {dialog.kind === 'action' && <>
          {dialog.action === 'offer' && actionIntent ? <div className="exchange-v2-outcome">
            <p><strong>You receive</strong><br />{exchangeAssignmentLabel(actionIntent.source)}</p>
            {dialog.offerSourceIds && dialog.offerSourceIds.length > 1 ? <fieldset className="exchange-v2-sources"><legend>Which assignment would you offer?</legend>
              {dialog.offerSourceIds.map(id => <label key={id}><input type="radio" name="offer-source" checked={dialog.assignmentId === id}
                onChange={() => setDialog({ ...dialog, assignmentId: id })} />{sourceLabel(id)}</label>)}</fieldset>
              : <p><strong>You give</strong><br />{sourceLabel(dialog.assignmentId)}</p>}
          </div> : actionCandidate && leg ? <div className="exchange-v2-outcome"><p>{actionCandidate.legs.length === 3 ? '3-way exchange' : 'Exchange'}
            {actionCandidate.legs.length > 2 && ` · ${actionCandidate.legs.length - 1} other students`}</p>
            <p><strong>You give</strong><br />{leg.give ? exchangeAssignmentLabel(leg.give) : 'No assignment'}</p>
            <p><strong>You receive</strong><br />{leg.receive ? exchangeAssignmentLabel(leg.receive) : 'No assignment'}</p></div>
            : actionTarget ? <div className="exchange-v2-outcome"><p><strong>You give</strong><br />{sourceLabel(dialog.assignmentId)}</p>
              <p><strong>You receive</strong><br />{exchangeAssignmentLabel(actionTarget.intent.source)}</p></div>
              : actionIntent && <p>{exchangeAssignmentLabel(actionIntent.source)}</p>}
        </>}
        {error && <p role="alert" className="duty-alert">{error}</p>}
        <div className="exchange-actions"><ActionButton variant="ghost" disabled={busy}
          onClick={() => dialog.kind === 'action' && dialog.returnTo ? setDialog(dialog.returnTo) : close()}>
          {dialog.kind === 'action' && dialog.returnTo ? 'Go back' : 'Cancel'}</ActionButton>
          <ActionButton variant="primary" type="submit" disabled={busy || loading ||
            (dialog.kind === 'target' && !selectedSource) || (dialog.kind === 'create' && selectedTargets.length > 10)}>
            {busy ? 'Saving…' : dialog.kind === 'create' ? 'Post exchange' : dialog.kind === 'target' ? 'Send request' :
              dialog.action === 'cancel' ? 'Cancel exchange' : dialog.action === 'claim' ? 'Take shift' :
              dialog.action === 'accept' ? 'Accept request' : dialog.action === 'offer' ? 'Offer assignment' :
              dialog.action === 'withdraw' ? 'Withdraw offer' : dialog.action === 'confirm' ? 'Accept exchange' :
              'Decline exchange'}</ActionButton></div>
      </form>
    </dialog>}
  </ExchangeContext.Provider>;
}

export function ExchangeV2AssignmentAction({ assignmentId }: { assignmentId: string }) {
  const context = useExchangeV2();
  if (!context?.enabled) return null;
  if (!context?.data) return context?.enabled && context.loading
    ? <span className="exchange-action-placeholder" role="status">Loading options…</span> : null;
  const state = context.state(assignmentId), assignment = context.assignments.find(item => item.id === assignmentId);
  if (!state || !assignment) return null;
  const { data, domain, busy, browseSource, selectedTargets } = context;
  const has = (action: string) => state.availableActions.some(item => item === action);
  if (browseSource && !assignment.own) {
    if (state.relationship === 'REQUEST_SENT') return <span className="exchange-inline-status">Request sent</span>;
    if (!state.requestableSourceAssignmentIds.includes(browseSource)) return null;
    return <label className="exchange-v2-row-choice"><input type="checkbox" checked={selectedTargets.includes(assignmentId)}
      onChange={() => context.setSelectedTargets(selectedTargets.includes(assignmentId) ? selectedTargets.filter(id => id !== assignmentId) : [...selectedTargets, assignmentId])}
      disabled={busy || (!selectedTargets.includes(assignmentId) && selectedTargets.length >= 10)} />
      {selectedTargets.includes(assignmentId) ? 'Selected' : 'Select target'}</label>;
  }
  if (assignment.own) {
    const ownIntent = data.intents.find(item => state.relatedIntentIds.includes(item.id) && item.owner.id === data.currentUserId && activeIntent(item));
    const ownOffer = data.intents.flatMap(intent => intent.offers.map(offer => ({ intent, offer })))
      .find(item => item.offer.offerer.id === data.currentUserId && item.offer.assignment.id === assignmentId && item.offer.status === 'OPEN');
    const reviewCandidate = data.candidates.find(item => state.relatedCandidateIds.includes(item.id) && activeCandidate(item) &&
      actorLeg(item, data.currentUserId)?.consentedAt === null);
    const waitingCandidate = data.candidates.find(item => state.relatedCandidateIds.includes(item.id) && activeCandidate(item) &&
      !!actorLeg(item, data.currentUserId)?.consentedAt);
    const incoming = data.intents.flatMap(intent => intent.targets.map(target => ({ intent, target })))
      .find(item => item.target.assignment.id === assignmentId && item.target.status === 'OPEN' && item.intent.owner.id !== data.currentUserId);
    if (reviewCandidate && has('CONFIRM_CANDIDATE')) return <div className="exchange-assignment-state"><span>Needs review</span>
      <ActionButton disabled={busy} onClick={() => context.open({ kind: 'action', action: 'confirm', id: reviewCandidate.id, assignmentId })}>Review exchange</ActionButton></div>;
    if (waitingCandidate) return <div className="exchange-assignment-state"><span>Waiting for others</span>
      <ContextLink to={`${path[domain]}/exchanges#candidate-${waitingCandidate.id}`}>Open exchange</ContextLink></div>;
    if (ownIntent) return <div className="exchange-assignment-state"><span>Looking for exchange{ownIntent.offers.filter(item => item.status === 'OPEN').length ?
      ` · ${ownIntent.offers.filter(item => item.status === 'OPEN').length} offers` : ''}{ownIntent.allowGiveAway ? ' · Give-away enabled' : ''}</span>
      {has('CANCEL_INTENT') && <ActionButton disabled={busy} onClick={() => context.open({ kind: 'action', action: 'cancel', id: ownIntent.id, assignmentId })}>Cancel</ActionButton>}
      <ContextLink to={`${path[domain]}/exchanges#intent-${ownIntent.id}`}>Open exchange</ContextLink></div>;
    if (ownOffer) return <div className="exchange-assignment-state"><span>Offer sent</span>
      {has('WITHDRAW_OFFER') && <ActionButton disabled={busy} onClick={() => context.open({ kind: 'action', action: 'withdraw', id: ownOffer.offer.id, assignmentId })}>Withdraw</ActionButton>}
      <ContextLink to={`${path[domain]}/exchanges#intent-${ownOffer.intent.id}`}>Open exchange</ContextLink></div>;
    if (incoming && has('ACCEPT_TARGET')) return <div className="exchange-assignment-state"><span>Request received</span>
      <ActionButton disabled={busy} onClick={() => context.open({ kind: 'action', action: 'accept', id: incoming.target.id, assignmentId })}>Review request</ActionButton></div>;
    if (has('OPEN_EXCHANGE')) return <div className="exchange-assignment-state"><ActionButton disabled={busy} onClick={() => context.open({ kind: 'create', sourceId: assignmentId })}>Exchange</ActionButton>
      {has('OFFER_SHIFT') && <ActionButton variant="ghost" disabled={busy} onClick={() => context.open({ kind: 'action', action: 'offer', id: state.offerableIntentIds[0], assignmentId })}>Offer a shift</ActionButton>}</div>;
    return null;
  }
  if (state.relationship === 'REQUEST_SENT') return <span className="exchange-inline-status">Request sent</span>;
  const giveaway = state.relationship === 'GIVE_AWAY_AVAILABLE';
  const intent = data.intents.find(item => state.relatedIntentIds.includes(item.id) && item.source.id === assignmentId && activeIntent(item));
  const offerSources = intent ? data.assignmentStates.filter(item => item.offerableIntentIds.includes(intent.id)).map(item => item.assignmentId) : [];
  if (!giveaway && state.relationship !== 'SWAP_AVAILABLE' && !has('REQUEST_SWAP')) return null;
  const owner = intentOwners(data, assignmentId);
  const canTake = has('TAKE_GIVE_AWAY') && !!intent;
  const canOffer = !!intent && offerSources.length > 0;
  return <div className="exchange-assignment-state">
    <span>{canTake && canOffer ? `${owner} is open to swap or give-away` : canTake ? `Give-away available from ${owner}` : `Swap wanted by ${owner}`}</span>
    {canOffer && <ActionButton disabled={busy} onClick={() => context.open({ kind: 'action', action: 'offer',
      id: intent.id, assignmentId: offerSources[0], offerSourceIds: offerSources })}>Offer a shift</ActionButton>}
    {canTake && <ActionButton disabled={busy} onClick={() => context.open({ kind: 'action', action: 'claim', id: intent.id, assignmentId })}>Take shift · +1 credit</ActionButton>}
    {has('REQUEST_SWAP') && offerSources.length === 0 && <ActionButton disabled={busy} onClick={() => context.open({ kind: 'target', targetId: assignmentId,
      sourceId: state.requestableSourceAssignmentIds[0] })}>Request swap</ActionButton>}
  </div>;
}

export function ExchangeV2Summary({ domain, center = false }: { domain: ExchangeDomain; center?: boolean }) {
  const context = useExchangeV2(), location = useLocation();
  const legacy = useLegacyOpportunities();
  const currentData = context?.data;
  useEffect(() => {
    if (!center || !currentData || !location.hash) return;
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.focus();
  }, [center, currentData, location.hash]);
  if (!context?.enabled) return null;
  const { data, error, loading, busy } = context;
  const mine = data?.intents.filter(item => activeIntent(item) && item.owner.id === data.currentUserId) ?? [];
  const available = data?.intents.filter(item => activeIntent(item) && item.owner.id !== data.currentUserId &&
    data.assignmentStates.some(state => state.offerableIntentIds.includes(item.id) ||
      state.relatedIntentIds.includes(item.id) &&
      (state.availableActions.includes('ACCEPT_TARGET') || state.availableActions.includes('TAKE_GIVE_AWAY') ||
        state.availableActions.includes('REQUEST_SWAP')))) ?? [];
  const candidates = data?.candidates.filter(item => activeCandidate(item) && !!actorLeg(item, data.currentUserId)) ?? [];
  const review = candidates.filter(item => actorLeg(item, data!.currentUserId)?.consentedAt === null);
  const previewV2 = available.slice(0, 4);
  const previewLegacy = legacy.slice(0, Math.max(0, 4 - previewV2.length));
  const extra = available.length + legacy.length - previewV2.length - previewLegacy.length;
  if (!center) return <section className="exchange-overview exchange-v2-overview" aria-label="Exchanges">
    <div className="exchange-v2-summary-heading"><h2>Exchanges</h2><ContextLink to={`${path[domain]}/exchanges`}>View all →</ContextLink></div>
    {loading && !data && <p role="status">Loading exchanges…</p>}
    {error && <p role="alert" className="duty-alert">{data ? 'Exchange refresh failed. Showing last available information.' : error}</p>}
    {(previewV2.length > 0 || previewLegacy.length > 0) && <ul className="exchange-preview-list">
      {previewV2.map(intent => <IntentRow key={intent.id} intent={intent} preview />)}
      {previewLegacy.map(item => <li key={`legacy-${item.id}`} className="exchange-row"><strong>{item.label}</strong><p className="exchange-note">{item.description}</p><div className="exchange-actions">{item.action}</div></li>)}
    </ul>}
    {extra > 0 && <ContextLink className="exchange-preview-more" to={`${path[domain]}/exchanges`}>{extra} more exchange{extra === 1 ? '' : 's'} →</ContextLink>}
    {data && !previewV2.length && !previewLegacy.length && (mine.length > 0 || review.length > 0) &&
      <p>{mine.length + review.length} exchange{mine.length + review.length === 1 ? '' : 's'} in progress</p>}
  </section>;
  return <section className="duty-exchanges exchange-v2-center" aria-label="Current exchanges">
    {loading && !data && <p role="status">Loading exchanges…</p>}{error && <p role="alert" className="duty-alert">{data ? 'Exchange refresh failed. Showing last available information.' : error}</p>}
    {data && <>
      {review.length > 0 && <><h3>Needs review</h3><ul>{review.map(candidate => <CandidateRow key={candidate.id} candidate={candidate} />)}</ul></>}
      {mine.length > 0 && <><h3>My exchanges</h3><ul>{mine.map(intent => <IntentRow key={intent.id} intent={intent} />)}</ul></>}
      {available.length > 0 && <><h3>Available</h3><ul>{available.map(intent => <IntentRow key={intent.id} intent={intent} />)}</ul></>}
      {candidates.filter(item => actorLeg(item, data.currentUserId)?.consentedAt).length > 0 && <><h3>Waiting for others</h3><ul>{candidates.filter(item => actorLeg(item, data.currentUserId)?.consentedAt).map(candidate =>
        <CandidateRow key={candidate.id} candidate={candidate} />)}</ul></>}
      {!mine.length && !available.length && !candidates.length && !legacy.length && <p className="duty-empty">No open exchanges</p>}
    </>}
    {busy && <p role="status">Saving exchange…</p>}
  </section>;
}

function CandidateRow({ candidate }: { candidate: ExchangeV2Candidate }) {
  const context = useExchangeV2()!, leg = actorLeg(candidate, context.data!.currentUserId);
  if (!leg) return null;
  const state = leg.give && context.state(leg.give.id);
  const canConfirm = !leg.consentedAt && state?.availableActions.includes('CONFIRM_CANDIDATE');
  return <li id={`candidate-${candidate.id}`} tabIndex={-1} className="exchange-row"><strong>{candidate.legs.length === 3 ? '3-way exchange' : 'Exchange'}</strong>
    <p className="exchange-time">You give {leg.give ? exchangeAssignmentLabel(leg.give) : 'no assignment'}</p>
    <p className="exchange-time">You receive {leg.receive ? exchangeAssignmentLabel(leg.receive) : 'no assignment'}</p>
    {canConfirm ? <div className="exchange-actions"><ActionButton onClick={() => context.open({ kind: 'action', action: 'confirm', id: candidate.id, assignmentId: leg.give!.id })}>Accept</ActionButton>
      <ActionButton variant="ghost" onClick={() => context.open({ kind: 'action', action: 'decline', id: candidate.id, assignmentId: leg.give!.id })}>Decline</ActionButton></div>
      : <p className="exchange-note">Waiting for others</p>}</li>;
}

function IntentRow({ intent, preview = false }: { intent: ExchangeV2Intent; preview?: boolean }) {
  const context = useExchangeV2()!, data = context.data!;
  const own = intent.owner.id === data.currentUserId;
  const state = context.state(intent.source.id);
  const offerSourceIds = data.assignmentStates.filter(item => item.offerableIntentIds.includes(intent.id)).map(item => item.assignmentId);
  const canTake = state?.availableActions.includes('TAKE_GIVE_AWAY') === true;
  const canOffer = offerSourceIds.length > 0;
  const target = intent.targets.find(item => item.status === 'OPEN' && context.state(item.assignment.id)?.availableActions.includes('ACCEPT_TARGET'));
  return <li id={`intent-${intent.id}`} tabIndex={-1} className="exchange-row"><strong>{own ? 'Your exchange' : canTake && canOffer ? `${displayName(intent.owner)} is open to swap or give-away` : canTake ? `Give-away available from ${displayName(intent.owner)}` : `Swap wanted by ${displayName(intent.owner)}`}</strong>
    <p className="exchange-time">{exchangeAssignmentLabel(intent.source)}</p>
    {!preview && intent.targets.filter(item => item.status === 'OPEN').length > 0 && <p className="exchange-note">{intent.targets.filter(item => item.status === 'OPEN').length} selected target{intent.targets.filter(item => item.status === 'OPEN').length === 1 ? '' : 's'}</p>}
    {!preview && intent.allowGiveAway && <p className="exchange-note">Give-away enabled</p>}
    {own && intent.offers.some(item => item.status === 'OPEN') && <p className="exchange-note">{intent.offers.filter(item => item.status === 'OPEN').length} offers</p>}
    <div className="exchange-actions">
      {own && state?.availableActions.includes('CANCEL_INTENT') && <ActionButton onClick={() => context.open({ kind: 'action', action: 'cancel', id: intent.id, assignmentId: intent.source.id })}>Cancel</ActionButton>}
      {!own && target && <ActionButton onClick={() => context.open({ kind: 'action', action: 'accept', id: target.id, assignmentId: target.assignment.id })}>Accept request</ActionButton>}
      {!own && canOffer && <ActionButton onClick={() => context.open({ kind: 'action', action: 'offer', id: intent.id,
        assignmentId: offerSourceIds[0], offerSourceIds })}>Offer a shift</ActionButton>}
      {!own && canTake && <ActionButton onClick={() => context.open({ kind: 'action', action: 'claim', id: intent.id, assignmentId: intent.source.id })}>Take shift · +1 credit</ActionButton>}
      {!own && !canOffer && !canTake && state?.availableActions.includes('REQUEST_SWAP') &&
        <ActionButton onClick={() => context.open({ kind: 'target', targetId: intent.source.id,
          sourceId: state.requestableSourceAssignmentIds[0] })}>Request swap</ActionButton>}
    </div>
  </li>;
}
