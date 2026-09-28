import { Outlet } from 'react-router';
import { useCurrentUser } from './CurrentUser';
import type { PermissionKey } from '../../../shared/authorization';

export function usePermissions() {
  const { user } = useCurrentUser();
  return { hasPermission: (permission: PermissionKey) => user?.permissions.includes(permission) === true };
}
export function RequirePermission({ permission }: { permission: PermissionKey }) {
  const { hasPermission } = usePermissions();
  return hasPermission(permission) ? <Outlet /> : <section><h1>Access denied</h1><p>You do not have access to this feature.</p></section>;
}
export function RequireAnyPermission({ permissions }: { permissions: readonly PermissionKey[] }) {
  const { hasPermission } = usePermissions();
  return permissions.some(hasPermission) ? <Outlet /> : <section><h1>Access denied</h1><p>You do not have access to this feature.</p></section>;
}
