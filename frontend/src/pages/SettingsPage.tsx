import { useCurrentUser } from '../app/CurrentUser';
import { usePwa } from '../pwa/PwaProvider';
import { useState } from 'react';
import { CredentialForm } from '../features/flightlogger/CredentialForm';
import { displayName } from '../../../shared/display-name';

export function SettingsPage() {
  const { user, loading } = useCurrentUser();
  const { canInstall, installed, installing, needsUpdate, error, install, update } = usePwa();
  const [replacing, setReplacing] = useState(false);
  return <section className="settings-page"><h1>Settings</h1>
    <div className="settings-list">
      <section className="settings-section">
        <h2>Account</h2>
        <div><p className="field-label">Signed in as</p><p className="account-email">{user ? displayName(user) : loading ? 'Loading account…' : 'Account unavailable'}</p>
          {user && <p className="small-note">{user.email}</p>}</div>
      </section>
      <section className="settings-section">
        <h2>FlightLogger</h2>
        <div>
          <div className="settings-inline"><p className="connection-status">Connected</p>{!replacing && <button className="refresh-button" onClick={() => setReplacing(true)}>Replace API key</button>}</div>
          {replacing && <><p>Verify a new API key before replacing your current connection.</p><CredentialForm replacement onCancel={() => setReplacing(false)} /></>}
        </div>
      </section>
      <section className="settings-section">
        <h2>Install Studentportal</h2>
        <div>
          {installed ? <p>Installed on this device.</p> : <>
            {canInstall && <button className="primary-button" onClick={install} disabled={installing}>{installing ? 'Opening install…' : 'Install app'}</button>}
            <p><strong>Android / desktop:</strong> use your browser’s Install app option.</p>
            <p><strong>iPhone / iPad:</strong> Safari → Share → Add to Home Screen.</p>
          </>}
          <p className="small-note">A connection is needed to sign in and load schedules.</p>
          {needsUpdate && <div className="update-action"><p>A new version is ready.</p><button className="primary-button" onClick={update}>Update and reload</button></div>}
          {error && <p role="status">{error}</p>}
        </div>
      </section>
      <section className="settings-section">
        <h2>Preferences & notifications</h2><p>Coming soon</p>
      </section>
    </div>
  </section>;
}
