import { useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import type { CreditsResponse, CreditStandingsResponse } from '../../../shared/duty-ops-credits';
import { DutyOpsNavigation } from '../features/duty-ops/DutyOpsNavigation';
import { creditSign, loadCredits, loadCreditStandings, loadCreditSummary } from '../features/duty-ops/credit-api';
import { acceptedLabel, historyShiftLabel, userName } from '../features/duty-ops/exchange-presentation';
import '../features/duty-ops/duty-ops.css';
import '../features/duty-ops/exchanges.css';
import '../features/duty-ops/credits.css';

export function DutyCreditsPage() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<CreditsResponse | null>(null), [standings, setStandings] = useState<CreditStandingsResponse | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const controller = useRef<AbortController | null>(null), pending = useRef(false);
  useEffect(() => {
    const current = new AbortController(); controller.current = current; pending.current = true;
    setData(null); setStandings(null); setError(''); setLoading(true);
    void Promise.all([loadCredits(current.signal), loadCreditStandings(current.signal)]).then(([credits, roster]) => {
      if (!current.signal.aborted) { setData(credits); setStandings(roster); }
    }).catch(cause => { if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load credits.'); })
      .finally(() => { if (!current.signal.aborted) { pending.current = false; setLoading(false); } });
    // Refresh balances without resetting keyset-paginated personal history.
    const poll = () => {
      if (document.hidden || pending.current) return;
      pending.current = true;
      void Promise.all([loadCreditSummary(current.signal), loadCreditStandings(current.signal)]).then(([summary, roster]) => {
        if (!current.signal.aborted) { setData(previous => previous ? { ...previous, ...summary } : previous); setStandings(roster); setError(''); }
      }).catch(cause => { if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not refresh credits.'); })
        .finally(() => { if (!current.signal.aborted) pending.current = false; });
    };
    const timer = window.setInterval(poll, 60000); document.addEventListener('visibilitychange', poll);
    return () => { current.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [reload, user?.subject]);
  async function more() {
    const current = controller.current;
    if (!data?.nextCursor || !current || pending.current) return;
    pending.current = true; setLoading(true); setError('');
    try {
      const next = await loadCredits(current.signal, data.nextCursor);
      if (!current.signal.aborted) setData(previous => previous ? { ...next, entries: [...previous.entries, ...next.entries.filter(e => !previous.entries.some(old => old.id === e.id))] } : next);
    } catch (cause) { if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load credit history.'); }
    finally { if (!current.signal.aborted) { pending.current = false; setLoading(false); } }
  }
  return <section className="duty-ops duty-credits">
    <div className="duty-heading"><h1>Credits</h1><button disabled={loading} onClick={() => setReload(n => n + 1)}>Reload</button></div>
    <DutyOpsNavigation />
    {loading && <p role="status" className="duty-loading">Loading credits…</p>}{error && <p role="alert" className="duty-alert">{error}</p>}
    {data && <><dl className="credit-summary"><div><dt>Credit balance</dt><dd>{creditSign(data.balance)}</dd></div>
      <div><dt>Shifts covered</dt><dd>{data.coveredCount}</dd></div><div><dt>Shifts covered for you</dt><dd>{data.receivedCount}</dd></div></dl>
      {data.balance <= -2 && <p className="exchange-note">Cover another student’s shift to earn a credit before giving away another shift. Direct swaps remain available.</p>}
      <section className="credit-section"><h2>Credit history</h2>{!data.entries.length ? <p className="duty-empty">No coverage transactions yet</p> : <ul>{data.entries.map(entry => <li key={entry.id} className="exchange-row">
        <div className="credit-history-heading"><strong>{creditSign(entry.amount)}</strong><span>{entry.amount === 1 ? 'Covered for' : 'Covered by'} {userName(entry.counterparty)}</span></div>
        <p className="exchange-time">Duty Ops · <time dateTime={entry.shift.startsAt}>{historyShiftLabel(entry.shift)}</time></p>
        <p className="exchange-note">Accepted <time dateTime={entry.createdAt}>{acceptedLabel(entry.createdAt)}</time></p>
      </li>)}</ul>}{data.nextCursor && <button disabled={loading} onClick={() => void more()}>Load more credit history</button>}</section>
    </>}
    {standings && <><section className="credit-section"><h2>Top contributors</h2>{!standings.topContributors.length ? <p className="duty-empty">No students yet</p> :
      <ol className="credit-contributors">{standings.topContributors.map(row => <li key={row.student.id}><span>{userName(row.student)}</span><strong>{creditSign(row.balance)}</strong><small>{row.coveredCount} covered</small></li>)}</ol>}</section>
      <section className="credit-section"><table className="credit-roster"><caption>All balances</caption><thead><tr><th scope="col">Student</th><th scope="col">Balance</th><th scope="col">Covered</th></tr></thead>
        <tbody>{standings.students.map(row => <tr key={row.student.id}><th scope="row">{userName(row.student)}</th><td>{creditSign(row.balance)}</td><td>{row.coveredCount}</td></tr>)}</tbody>
      </table>{!standings.students.length && <p className="duty-empty">No students yet</p>}</section></>}
  </section>;
}
