import { useCurrentUser } from '../app/CurrentUser';
import { usePwa } from '../pwa/PwaProvider';
import { useState } from 'react';
import { CredentialForm } from '../features/flightlogger/CredentialForm';

export function SettingsPage() {
  const { user, loading } = useCurrentUser();
  const { canInstall, installed, installing, needsUpdate, error, install, update } = usePwa();
  const [replacing, setReplacing] = useState(false);
  return <section><p className="eyebrow">Studentportal</p><h1>Settings</h1><p className="subtitle">Your account and the portal on your device.</p>
    <div className="settings-grid"><section className="settings-panel"><h2>Account</h2><p className="field-label">Signed in as</p><p className="account-email">{user?.email || (loading ? 'Loading account…' : 'Account unavailable')}</p><p>Authentication is managed by Cloudflare Access.</p></section>
      <section className="settings-panel"><h2>FlightLogger</h2><p className="connection-status">Connected</p>{replacing ? <><p>Verify a new API key before replacing your current connection.</p><CredentialForm replacement onCancel={() => setReplacing(false)} /></> : <button className="refresh-button" onClick={() => setReplacing(true)}>Replace API key</button>}</section>
      <section className="settings-panel"><h2>Install Studentportal</h2>{installed ? <p>The portal is running as an installed app.</p> : <><p>Keep the portal within easy reach on your phone or desktop.</p>{canInstall && <button className="primary-button" onClick={install} disabled={installing}>{installing ? 'Opening install…' : 'Install app'}</button>}<p><strong>Android / desktop:</strong> use your browser’s Install app option when available.</p><p><strong>iPhone / iPad:</strong> open in Safari, tap Share, then Add to Home Screen.</p></>}
        <p className="small-note">A connection is needed to sign in and load schedules.</p>{needsUpdate && <div className="update-action"><p>A new version of the portal is ready.</p><button className="primary-button" onClick={update}>Update and reload</button></div>}{error && <p role="status">{error}</p>}</section>
      <section className="settings-panel"><h2>Preferences & notifications</h2><p>Portal preferences and operational notifications are planned for a later phase.</p></section></div>
  </section>;
}
