import { Route, Routes, Link, Navigate } from 'react-router';
import { AppShell } from './AppShell';
import { CurrentUserProvider } from './CurrentUser';
import { HomePage } from '../pages/HomePage';
import AvailabilityPage from '../pages/AvailabilityPage';
import { DutyOpsPage } from '../pages/DutyOpsPage';
import { BrakkevaktPage } from '../pages/BrakkevaktPage';
import { BrakkevaktManagePage } from '../pages/BrakkevaktManagePage';
import { FlyvaskPage } from '../pages/FlyvaskPage';
import { FlightsPage } from '../pages/FlightsPage';
import { DutyShiftPage } from '../pages/DutyShiftPage';
import { SettingsPage } from '../pages/SettingsPage';
import { PwaProvider } from '../pwa/PwaProvider';
import { AccountGate, RequireFlightLogger } from './OnboardingGate';
import { OnboardingPage } from '../pages/OnboardingPage';
import { RequirePermission, RequireAnyPermission } from './permissions';
import { PERMISSIONS } from '../../../shared/authorization';
import { AdminUsersPage } from '../pages/AdminUsersPage';
import { AdminPage } from '../pages/AdminPage';
import { MyActivityPage } from '../pages/MyActivityPage';
import { DutyCreditAuditPage } from '../pages/DutyCreditAuditPage';
import { FeedbackPage,ContactListPage,ContactDetailPage,InboxPage } from '../pages/ContactPages';

export function PortalRoutes() {
  return <Routes><Route element={<AccountGate />}>
    <Route path="onboarding" element={<OnboardingPage />} />
    <Route element={<RequireFlightLogger />}><Route element={<AppShell />}>
    <Route index element={<HomePage />} />
    <Route element={<RequirePermission permission={PERMISSIONS.availabilityView} />}><Route path="availability" element={<Navigate to="/admin/availability" replace />} /><Route path="admin/availability" element={<AvailabilityPage />} /></Route>
    <Route element={<RequirePermission permission={PERMISSIONS.dutyOpsView} />}>
      <Route path="duty-ops" element={<DutyOpsPage />} />
      <Route path="duty-ops/shifts/:shiftId" element={<DutyShiftPage />} />
      <Route path="duty-ops/swap-history" element={<Navigate to="/activity?module=duty-ops" replace />} />
      <Route path="duty-ops/credits" element={<Navigate to="/activity?module=duty-ops" replace />} />
    </Route>
    <Route element={<RequirePermission permission={PERMISSIONS.brakkevaktView} />}>
      <Route path="brakkevakt" element={<BrakkevaktPage />} />
      <Route path="brakkevakt/swap-history" element={<Navigate to="/activity?module=brakkevakt" replace />} />
    </Route>
    <Route element={<RequirePermission permission={PERMISSIONS.brakkevaktManageSchedule} />}>
      <Route path="brakkevakt/manage" element={<BrakkevaktManagePage />} />
    </Route>
    <Route element={<RequirePermission permission={PERMISSIONS.flightsView} />}><Route path="flights" element={<FlightsPage />} /></Route>
    <Route element={<RequirePermission permission={PERMISSIONS.flyvaskView} />}>
      <Route path="flyvask" element={<FlyvaskPage />} />
      <Route path="flyvask/swap-history" element={<Navigate to="/activity?module=flyvask" replace />} />
    </Route>
    <Route element={<RequirePermission permission={PERMISSIONS.adminManageUsers} />}><Route path="admin/users" element={<AdminUsersPage />} /></Route>
    <Route element={<RequirePermission permission={PERMISSIONS.dutyOpsManageSchedule} />}><Route path="admin/duty-ops/credits" element={<DutyCreditAuditPage />} /></Route>
    <Route element={<RequirePermission permission={PERMISSIONS.contactWebmasterManage} />}><Route path="admin/contact" element={<ContactListPage admin />} /><Route path="admin/contact/:threadId" element={<ContactDetailPage admin />} /></Route>
    <Route element={<RequireAnyPermission permissions={[PERMISSIONS.adminManageUsers, PERMISSIONS.availabilityView, PERMISSIONS.dutyOpsManageSchedule,PERMISSIONS.contactWebmasterManage]} />}><Route path="admin" element={<AdminPage />} /></Route>
    <Route path="activity" element={<MyActivityPage />} />
    <Route path="feedback" element={<FeedbackPage />} />
    <Route path="messages" element={<ContactListPage />} />
    <Route path="messages/:threadId" element={<ContactDetailPage />} />
    <Route path="inbox" element={<InboxPage />} />
    <Route path="settings" element={<SettingsPage />} />
    <Route path="*" element={<section><h1>Page not found</h1><Link className="action-link" to="/">Return home →</Link></section>} />
    </Route></Route>
  </Route></Routes>;
}

export default function App() {
  return <CurrentUserProvider><PwaProvider><PortalRoutes /></PwaProvider></CurrentUserProvider>;
}
