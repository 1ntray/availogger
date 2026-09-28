import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { CreditStandingsResponse } from '../../../shared/duty-ops-credits';
import { loadCreditStandings, creditSign } from '../features/duty-ops/credit-api';
import { userName } from '../features/duty-ops/exchange-presentation';
import '../features/duty-ops/credits.css';

export function DutyCreditAuditPage() {
  const [data, setData] = useState<CreditStandingsResponse | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void loadCreditStandings(controller.signal).then(setData).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load credit audit.');
    });
    return () => controller.abort();
  }, [reload]);
  return <section className="duty-ops duty-credits"><Link className="action-link" to="/admin">← Administration</Link>
    <div className="duty-heading"><h1>Duty Ops credit audit</h1><button onClick={() => setReload(n => n + 1)}>Reload</button></div>
    {error && <p role="alert" className="duty-alert">{error}</p>}
    {!data && !error && <p role="status">Loading balances…</p>}
    {data && <><section className="credit-section"><h2>Top contributors</h2><ol className="credit-contributors">{data.topContributors.map(row => <li key={row.student.id}><span>{userName(row.student)}</span><strong>{creditSign(row.balance)}</strong><small>{row.coveredCount} covered</small></li>)}</ol></section>
      <section className="credit-section"><table className="credit-roster"><caption>All balances</caption><thead><tr><th scope="col">Student</th><th scope="col">Balance</th><th scope="col">Covered</th></tr></thead><tbody>{data.students.map(row => <tr key={row.student.id}><th scope="row">{userName(row.student)}</th><td>{creditSign(row.balance)}</td><td>{row.coveredCount}</td></tr>)}</tbody></table></section></>}
  </section>;
}
