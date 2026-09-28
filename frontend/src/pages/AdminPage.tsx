import { Link } from 'react-router';
import { usePermissions } from '../app/permissions';
import { PERMISSIONS } from '../../../shared/authorization';

export function AdminPage() {
  const { hasPermission } = usePermissions();
  const entries = [
    { path: '/admin/users', label: 'Users & access', permission: PERMISSIONS.adminManageUsers },
    { path: '/admin/availability', label: 'Instructor availability', permission: PERMISSIONS.availabilityView },
    { path: '/admin/duty-ops/credits', label: 'Duty Ops credit audit', permission: PERMISSIONS.dutyOpsManageSchedule },
  ];
  return <section className="admin-hub"><h1>Administration</h1><nav aria-label="Administration tools">
    {entries.filter(entry => hasPermission(entry.permission)).map(entry => <Link key={entry.path} to={entry.path}>{entry.label}<span aria-hidden="true">→</span></Link>)}
  </nav></section>;
}
