import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useCurrentUser } from '../../app/CurrentUser';
import { connectFlightLogger } from './credential-api';

export function CredentialForm({ replacement = false, onCancel }: { replacement?: boolean; onCancel?: () => void }) {
  const { refresh } = useCurrentUser();
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const field = useId();
  useEffect(() => () => pending.current?.abort(), []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError('');
    try {
      await connectFlightLogger(apiKey, controller.signal);
      setApiKey(''); // Discard before refreshing the account / navigating away.
      await refresh();
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The connection could not be saved. Try again.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <form className="credential-form" onSubmit={submit} autoComplete="off">
    <label htmlFor={field}>FlightLogger API key</label>
    <input id={field} name="flightlogger-api-key" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)}
      autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={4096} disabled={busy} aria-describedby={`${field}-security`} />
    <p id={`${field}-security`} className="small-note">Your API key is stored securely and is only used by Studentportal to access your FlightLogger data.</p>
    {error && <p className="credential-error" role="alert">{error}</p>}
    <div className="credential-actions"><button className="primary-button" disabled={busy || !apiKey.trim()}>{busy ? 'Verifying connection…' : replacement ? 'Replace API key' : 'Connect FlightLogger'}</button>
      {onCancel && <button type="button" className="refresh-button" onClick={onCancel} disabled={busy}>Cancel</button>}</div>
  </form>;
}
