import { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { FlyvaskNavigation } from '../features/flyvask/FlyvaskNavigation';
import { loadSwapHistory } from '../features/flyvask/exchange-api';
import { acceptedLabel, historyShiftLabel, userName } from '../features/flyvask/exchange-presentation';
import type { ExchangeHistoryResponse, ExchangeShift } from '../../../shared/flyvask-swaps';
import '../features/duty-ops/duty-ops.css';
import '../features/duty-ops/exchanges.css';

function HistoryShift({ label, shift }: { label: string; shift: ExchangeShift }) {
  return <div><span className="duty-source">{label}</span><time dateTime={shift.startsAt}>{historyShiftLabel(shift)}</time></div>;
}
export function FlyvaskSwapHistoryPage() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<ExchangeHistoryResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    const current = new AbortController(); controller.current = current; pending.current = true;
    setData(null); setError(''); setLoading(true);
    loadSwapHistory(current.signal).then(value => { if (!current.signal.aborted) setData(value); })
      .catch(cause => { if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load swap history.'); })
      .finally(() => { if (!current.signal.aborted) { setLoading(false); pending.current = false; } });
    return () => current.abort();
  }, [reload, user?.subject]);
  async function more() {
    const current = controller.current;
    if (!data?.nextCursor || !current || pending.current) return;
    pending.current = true; setLoading(true); setError('');
    try {
      const next = await loadSwapHistory(current.signal, data.nextCursor);
      if (!current.signal.aborted) setData(previous => previous ? { ...next, entries: [...previous.entries, ...next.entries.filter(e => !previous.entries.some(old => old.id === e.id))] } : next);
    } catch (cause) { if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load swap history.'); }
    finally { if (!current.signal.aborted) { pending.current = false; setLoading(false); } }
  }
  return <section className="duty-ops">
    <div className="duty-heading"><h1>Flyvask swap history</h1><button disabled={loading} onClick={() => setReload(n => n + 1)}>Reload</button></div>
    <FlyvaskNavigation />
    <p className="exchange-note">Agreements in Studentportal · Europe/Oslo. FlightLogger is not updated automatically.</p>
    {loading && <p role="status" className="duty-loading">Loading swap history…</p>}
    {error && <p role="alert" className="duty-alert">{error}</p>}
    {data && (data.entries.length ? <ul className="swap-history">{data.entries.map(entry => <li key={entry.id} className="exchange-row">
      <strong>{`Swapped with ${userName(entry.counterparty)}`}</strong>
      <div className="swap-history-shifts">
        {entry.givenShift && <HistoryShift label="You gave" shift={entry.givenShift} />}
        {entry.receivedShift && <HistoryShift label="You received" shift={entry.receivedShift} />}
      </div>
      <p className="exchange-note">Accepted <time dateTime={entry.acceptedAt}>{acceptedLabel(entry.acceptedAt)}</time></p>
    </li>)}</ul> : <p className="duty-empty">No accepted exchanges yet</p>)}
    {data?.nextCursor && <button disabled={loading} onClick={() => void more()}>Load more history</button>}
  </section>;
}
