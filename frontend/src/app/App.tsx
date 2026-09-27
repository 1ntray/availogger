import { Route, Routes, Link } from 'react-router';
import { AppShell } from './AppShell';
import { CurrentUserProvider } from './CurrentUser';
import { HomePage } from '../pages/HomePage';
import AvailabilityPage from '../pages/AvailabilityPage';
import { DutyOpsPage } from '../pages/DutyOpsPage';
import { DutySwapHistoryPage } from '../pages/DutySwapHistoryPage';
import { DutyCreditsPage } from '../pages/DutyCreditsPage';
import { FlyvaskPage } from '../pages/FlyvaskPage';
import { FlightsPage } from '../pages/FlightsPage';
import { DutyShiftPage } from '../pages/DutyShiftPage';
import { FlyvaskSwapHistoryPage } from '../pages/FlyvaskSwapHistoryPage';
import { TransportPage } from '../pages/TransportPage';
import { SettingsPage } from '../pages/SettingsPage';
import { PwaProvider } from '../pwa/PwaProvider';
import { AccountGate, RequireFlightLogger } from './OnboardingGate';
import { OnboardingPage } from '../pages/OnboardingPage';
import { RequirePermission } from './permissions';
import { PERMISSIONS } from '../../../shared/authorization';
import { AdminUsersPage } from '../pages/AdminUsersPage';

export function PortalRoutes() {
  return <Routes><Route element={<AccountGate />}>
    <Route path="onboarding" element={<OnboardingPage />} />
    <Route element={<RequireFlightLogger />}><Route element={<AppShell />}>
    <Route index element={<HomePage />} />
    <Route element={<RequirePermission permission={PERMISSIONS.availabilityView} />}><Route path="availability" element={<AvailabilityPage />} /></Route>
    <Route element={<RequirePermission permission={PERMISSIONS.dutyOpsView} />}>
      <Route path="duty-ops" element={<DutyOpsPage />} />
      <Route path="duty-ops/shifts/:shiftId" element={<DutyShiftPage />} />
      <Route path="duty-ops/swap-history" element={<DutySwapHistoryPage />} />
      <Route path="duty-ops/credits" element={<DutyCreditsPage />} />
    </Route>
    <Route element={<RequirePermission permission={PERMISSIONS.flightsView} />}><Route path="flights" element={<FlightsPage />} /></Route>
    <Route element={<RequirePermission permission={PERMISSIONS.transportView} />}><Route path="transport" element={<TransportPage />} /></Route>
    <Route element={<RequirePermission permission={PERMISSIONS.flyvaskView} />}>
      <Route path="flyvask" element={<FlyvaskPage />} />
      <Route path="flyvask/swap-history" element={<FlyvaskSwapHistoryPage />} />
    </Route>
    <Route element={<RequirePermission permission={PERMISSIONS.adminManageUsers} />}><Route path="admin/users" element={<AdminUsersPage />} /></Route>
    <Route path="settings" element={<SettingsPage />} />
    <Route path="*" element={<section><h1>Page not found</h1><Link className="action-link" to="/">Return home →</Link></section>} />
    </Route></Route>
  </Route></Routes>;
}

export default function App() {
  return <CurrentUserProvider><PwaProvider><PortalRoutes /></PwaProvider></CurrentUserProvider>;
}
