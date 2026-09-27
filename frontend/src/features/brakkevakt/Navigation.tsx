import { NavLink } from 'react-router';
import { useCurrentUser } from '../../app/CurrentUser';
import { PERMISSIONS } from '../../../../shared/authorization';
export function BrakkevaktNavigation() {
  const { user } = useCurrentUser();
  return <nav className="duty-navigation" aria-label="Brakkevakt views">
    <NavLink to="/brakkevakt" end>Schedule</NavLink><NavLink to="/brakkevakt/swap-history">Swap history</NavLink>
    {user?.permissions?.includes(PERMISSIONS.brakkevaktManageSchedule) && <NavLink to="/brakkevakt/manage">Manage schedule</NavLink>}
  </nav>;
}
