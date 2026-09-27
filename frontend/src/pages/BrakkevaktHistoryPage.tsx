import { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import type { BrakkevaktSwapHistory } from '../../../shared/brakkevakt';
import { loadHistory } from '../features/brakkevakt/api';
import { personName, weekLabel } from '../features/brakkevakt/presentation';
import { BrakkevaktNavigation } from '../features/brakkevakt/Navigation';
import '../features/duty-ops/duty-ops.css';
import '../features/duty-ops/exchanges.css';
export function BrakkevaktHistoryPage() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<BrakkevaktSwapHistory | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true), [reload, setReload] = useState(0);
  const controller = useRef<AbortController | null>(null), pending = useRef(false);
  useEffect(() => {
    const current = new AbortController(); controller.current = current; pending.current = true;
    setData(null); setError(''); setLoading(true);
    void loadHistory(current.signal).then(value => { if (!current.signal.aborted) setData(value); })
      .catch(cause => { if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load swap history.'); })
      .finally(() => { if (!current.signal.aborted) { setLoading(false); pending.current = false; } });
    return () => current.abort();
  }, [reload, user?.subject]);
  async function more() {
    const current = controller.current;
    if (!data?.nextCursor || !current || pending.current) return;
    pending.current = true; setLoading(true); setError('');
    try { const next = await loadHistory(current.signal, data.nextCursor);
      if (!current.signal.aborted) setData(previous => previous ? { ...next, entries: [...previous.entries, ...next.entries.filter(e => !previous.entries.some(old => old.id === e.id))] } : next);
    } catch (cause) { if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load history.'); }
    finally { if (!current.signal.aborted) { pending.current = false; setLoading(false); } }
  }
  return <section className="duty-ops"><div className="duty-heading"><h1>Brakkevakt swap history</h1><button disabled={loading} onClick={() => setReload(v => v + 1)}>Reload</button></div>
    <BrakkevaktNavigation />
    {loading && <p role="status" className="duty-loading">Loading swap history…</p>}{error && <p role="alert" className="duty-alert">{error}</p>}
    {data && (data.entries.length ? <ul className="swap-history">{data.entries.map(e => <li key={e.id} className="exchange-row">
      <strong>Swapped with {personName(e.counterparty)}</strong><div className="swap-history-shifts">
        <div><span className="duty-source">You gave</span><time dateTime={e.givenWeekStart}>{weekLabel(e.givenWeekStart, true)}</time></div>
        <div><span className="duty-source">You received</span><time dateTime={e.receivedWeekStart}>{weekLabel(e.receivedWeekStart, true)}</time></div>
      </div><p className="exchange-note">Accepted <time dateTime={e.acceptedAt}>{new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(e.acceptedAt))}</time></p>
    </li>)}</ul> : <p className="duty-empty">No accepted swaps yet</p>)}
    {data?.nextCursor && <button disabled={loading} onClick={() => void more()}>Load more history</button>}
  </section>;
}
