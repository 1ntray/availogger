import { Route, Routes, Link } from 'react-router';
import { AppShell } from './AppShell';
import { CurrentUserProvider } from './CurrentUser';
import { HomePage } from '../pages/HomePage';
import AvailabilityPage from '../pages/AvailabilityPage';
import { DutyOpsPage } from '../pages/DutyOpsPage';
import { TransportPage } from '../pages/TransportPage';
import { SettingsPage } from '../pages/SettingsPage';
import { PwaProvider } from '../pwa/PwaProvider';
import { AccountGate, RequireFlightLogger } from './OnboardingGate';
import { OnboardingPage } from '../pages/OnboardingPage';

export function PortalRoutes() {
  return <Routes><Route element={<AccountGate />}>
    <Route path="onboarding" element={<OnboardingPage />} />
    <Route element={<RequireFlightLogger />}><Route element={<AppShell />}>
    <Route index element={<HomePage />} />
    <Route path="availability" element={<AvailabilityPage />} />
    <Route path="duty-ops" element={<DutyOpsPage />} />
    <Route path="transport" element={<TransportPage />} />
    <Route path="settings" element={<SettingsPage />} />
    <Route path="*" element={<section><p className="eyebrow">Studentportal</p><h1>Page not found</h1><p className="subtitle">This page is not part of the portal.</p><Link className="action-link" to="/">Return home →</Link></section>} />
    </Route></Route>
  </Route></Routes>;
}

export default function App() {
  return <CurrentUserProvider><PwaProvider><PortalRoutes /></PwaProvider></CurrentUserProvider>;
}
