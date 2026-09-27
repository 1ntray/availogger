import { PERMISSIONS, type PermissionKey } from '../../../shared/authorization';

export const navigation = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/duty-ops', label: 'Duty Ops', icon: 'duty', permission: PERMISSIONS.dutyOpsView },
  { path: '/transport', label: 'Transport', icon: 'transport', permission: PERMISSIONS.transportView },
  { path: '/flyvask', label: 'Flyvask', icon: 'wash', permission: PERMISSIONS.flyvaskView },
  { path: '/brakkevakt', label: 'Brakkevakt', icon: 'calendar', permission: PERMISSIONS.brakkevaktView },
  { path: '/availability', label: 'Availability', icon: 'calendar', permission: PERMISSIONS.availabilityView },
  { path: '/settings', label: 'Settings', icon: 'settings' },
  { path: '/admin/users', label: 'Admin', icon: 'account', permission: PERMISSIONS.adminManageUsers },
] as const;
export function visibleNavigation(hasPermission: (permission: PermissionKey) => boolean) {
  return navigation.filter(item => !('permission' in item) || hasPermission(item.permission));
}
export type NavIcon = typeof navigation[number]['icon'] | 'more';
