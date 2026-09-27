import { Navigate } from 'react-router';
import { useCurrentUser } from '../app/CurrentUser';
import { CredentialForm } from '../features/flightlogger/CredentialForm';

export function OnboardingPage() {
  const { user } = useCurrentUser();
  if (user?.onboardingComplete && user.hasFlightLoggerCredential) return <Navigate to="/" replace />;
  return <div className="onboarding-screen">
    <header className="portal-header"><div className="brand"><span className="brand-mark">LF</span><div><strong>Luftfartsfag</strong><span>Studentportal</span></div></div><span className="current-user">{user?.email}</span></header>
    <main className="onboarding-main"><section className="settings-panel"><h1>Connect FlightLogger</h1>
      <p>The portal uses your personal FlightLogger API key to access the FlightLogger information available to your account.</p>
      <CredentialForm />
      <p className="small-note">For API access guidance, consult the API section of FlightLogger’s Help Center from your FlightLogger account. <a href="https://api.flightlogger.net/" target="_blank" rel="noreferrer">API reference ↗</a></p>
    </section></main>
  </div>;
}
