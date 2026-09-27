import { Navigate } from 'react-router';
import { useCurrentUser } from '../app/CurrentUser';
import { CredentialForm } from '../features/flightlogger/CredentialForm';

export function OnboardingPage() {
  const { user } = useCurrentUser();
  if (user?.onboardingComplete && user.hasFlightLoggerCredential) return <Navigate to="/" replace />;
  return <div className="onboarding-screen">
    <header className="portal-header"><div className="brand"><span className="brand-mark">LF</span><div><strong>Luftfartsfag</strong><span>Studentportal</span></div></div><span className="current-user">{user?.email}</span></header>
    <main className="onboarding-main"><section className="settings-panel"><h1>Connect FlightLogger</h1>
      <p>To use Studentportal, create a personal FlightLogger API key.</p>
      <ol className="onboarding-guide">
        <li><a className="refresh-button" href="https://my.flightlogger.net/my/api_keys" target="_blank" rel="noopener noreferrer">Open FlightLogger API keys</a></li>
        <li>Click <strong>Create key</strong>.</li>
        <li>Enter any name for the key, for example <strong>Studentportal</strong>.</li>
        <li>Make sure <strong>Global</strong> is not checked and <strong>No expiry</strong> is checked.</li>
        <li>Click <strong>Create</strong>.</li>
        <li>Copy the API key that appears.</li>
        <li>Return to Studentportal and paste the key below.</li>
      </ol>
      <CredentialForm />
    </section></main>
  </div>;
}
