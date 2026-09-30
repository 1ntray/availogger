import { ContextLink } from '../app/controls';
import { usePermissions } from '../app/permissions';
import { otherEnvironment } from '../app/environments';
import { PERMISSIONS } from '../../../shared/authorization';

export function AdminPage() {
  const { hasPermission } = usePermissions();
  const entries = [
    { path: '/admin/users', label: 'Users & access', permission: PERMISSIONS.adminManageUsers },
    { path: '/admin/availability', label: 'Instructor availability', permission: PERMISSIONS.availabilityView },
    { path: '/admin/duty-ops/credits', label: 'Duty Ops credit audit', permission: PERMISSIONS.dutyOpsManageSchedule },
    { path: '/admin/contact', label: 'Contact messages', permission: PERMISSIONS.contactWebmasterManage },
    { path: '/admin/exchanges', label: 'Exchange audit', permission: PERMISSIONS.adminExchangeAudit },
  ];
  const environment = hasPermission(PERMISSIONS.adminManageUsers) ? otherEnvironment(window.location.hostname) : null;
  return <section className="admin-hub"><h1>Administration</h1><nav aria-label="Administration tools">
    {entries.filter(entry => hasPermission(entry.permission)).map(entry => <ContextLink key={entry.path} to={entry.path}>{entry.label}<span aria-hidden="true">→</span></ContextLink>)}
  </nav>
    {environment && <section className="admin-environment" aria-labelledby="admin-environment-heading">
      <h2 id="admin-environment-heading">Environments</h2>
      <p>{environment.description}</p>
      <nav aria-label="Environments"><a href={environment.href} target="_blank" rel="noopener noreferrer">{environment.label}<span aria-hidden="true">↗</span></a></nav>
    </section>}
  </section>;
}
