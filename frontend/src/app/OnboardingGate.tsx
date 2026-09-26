import { Navigate, Outlet } from 'react-router';
import { useCurrentUser } from './CurrentUser';

export function AccountGate() {
  const { user, loading, error, retry } = useCurrentUser();
  if (loading || error || !user) return <div className="onboarding-screen">
    <header className="portal-header"><div className="brand"><span className="brand-mark">LF</span><div><strong>Luftfartsfag</strong><span>Studentportal</span></div></div></header>
    <main className="onboarding-main">{loading ? <div className="message" role="status">Loading your portal account…</div>
      : <div className="message error" role="alert"><strong>Your portal account could not be loaded.</strong><p>{error || 'Please try again.'}</p><button onClick={retry}>Retry account</button> <button onClick={() => window.location.reload()}>Reload page</button></div>}</main>
  </div>;
  return <Outlet />;
}

export function RequireFlightLogger() {
  const { user } = useCurrentUser();
  return user?.hasFlightLoggerCredential && user.onboardingComplete ? <Outlet /> : <Navigate to="/onboarding" replace />;
}
