import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../app/Icon';
import { osloDate } from '../dates';
import { usePermissions } from '../app/permissions';
import { PERMISSIONS } from '../../../shared/authorization';
import { useCurrentUser } from '../app/CurrentUser';
import { HomeDutyOps } from '../features/duty-ops/HomeDutyOps';

const modules = [
  { path: '/duty-ops', label: 'Duty Ops', icon: 'duty', comingSoon: false, permission: PERMISSIONS.dutyOpsView },
  { path: '/flyvask', label: 'Flyvask', icon: 'wash', comingSoon: false, permission: PERMISSIONS.flyvaskView },
  { path: '/brakkevakt', label: 'Brakkevakt', icon: 'calendar', comingSoon: false, permission: PERMISSIONS.brakkevaktView },
  { path: '/transport', label: 'Transport', icon: 'transport', comingSoon: true, permission: PERMISSIONS.transportView },
  { path: '/availability', label: 'Instructor availability', icon: 'calendar', comingSoon: false, permission: PERMISSIONS.availabilityView },
] as const;

export function HomePage() {
  const { hasPermission } = usePermissions();
  const { user } = useCurrentUser();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = osloDate(new Date(now));
  const dateLabel = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' }).format(new Date(now));
  return <section className="home-page">
    <header className="home-heading"><h1>Home</h1><time className="today-date" dateTime={today}>{dateLabel}</time></header>
    {hasPermission(PERMISSIONS.dutyOpsView) && <HomeDutyOps key={`${user?.subject}:${user?.flightLoggerUserId}`} now={now} />}
    <section className="quick-access" aria-labelledby="quick-access-heading">
      <h2 id="quick-access-heading">Quick access</h2>
      <div className="module-grid">{modules.filter(module => hasPermission(module.permission)).map(module =>
        <Link className="module-link" to={module.path} key={module.path}>
          <span className="module-icon"><Icon name={module.icon} /></span>
          <span className="module-title">{module.label}{module.comingSoon && <span className="module-note">Coming soon</span>}</span>
          <Icon name="arrow-right" />
        </Link>
      )}</div>
    </section>
  </section>;
}
