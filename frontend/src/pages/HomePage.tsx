import { Link } from 'react-router';
import { Icon } from '../app/Icon';
import { osloDate } from '../dates';
import { usePermissions } from '../app/permissions';
import { PERMISSIONS } from '../../../shared/authorization';

const modules = [
  { path: '/duty-ops', label: 'Duty Ops', icon: 'duty', comingSoon: true, permission: PERMISSIONS.dutyOpsView },
  { path: '/availability', label: 'Instructor availability', icon: 'calendar', comingSoon: false, permission: PERMISSIONS.availabilityView },
  { path: '/transport', label: 'Transport', icon: 'transport', comingSoon: true, permission: PERMISSIONS.transportView },
] as const;

export function HomePage() {
  const { hasPermission } = usePermissions();
  const today = osloDate(new Date());
  const dateLabel = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' }).format(new Date());
  return <section className="home-page">
    <header className="home-heading"><h1>Home</h1><time className="today-date" dateTime={today}>{dateLabel}</time></header>
    <section className="today-overview" aria-labelledby="today-heading">
      <h2 id="today-heading">Today</h2>
      <p>Nothing scheduled</p>
    </section>
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
