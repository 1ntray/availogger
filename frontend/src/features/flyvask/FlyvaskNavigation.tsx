import { NavLink } from 'react-router';
export function FlyvaskNavigation() {
  return <nav className="duty-navigation" aria-label="Flyvask views">
    <NavLink to="/flyvask" end>Overview</NavLink>
    <NavLink to="/flyvask/swap-history">Swap history</NavLink>
  </nav>;
}
