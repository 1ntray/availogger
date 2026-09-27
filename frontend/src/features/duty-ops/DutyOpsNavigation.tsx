import { NavLink } from 'react-router';
export function DutyOpsNavigation() {
  return <nav className="duty-navigation" aria-label="Duty Ops views">
    <NavLink to="/duty-ops" end>Overview</NavLink>
    <NavLink to="/duty-ops/swap-history">Swap history</NavLink>
    <NavLink to="/duty-ops/credits">Credits</NavLink>
  </nav>;
}
