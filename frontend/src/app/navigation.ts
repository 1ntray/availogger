import { PERMISSIONS, type PermissionKey } from '../../../shared/authorization';

export const navigation = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/flights', label: 'Flights', icon: 'flights', permission: PERMISSIONS.flightsView },
  { path: '/duty-ops', label: 'Duty Ops', icon: 'duty', permission: PERMISSIONS.dutyOpsView },
  { path: '/flyvask', label: 'Flyvask', icon: 'wash', permission: PERMISSIONS.flyvaskView },
  { path: '/brakkevakt', label: 'Brakkevakt', icon: 'calendar', permission: PERMISSIONS.brakkevaktView },
] as const;
export function visibleNavigation(hasPermission: (permission: PermissionKey) => boolean) {
  return navigation.filter(item => !('permission' in item) || hasPermission(item.permission));
}
export type NavIcon = typeof navigation[number]['icon'] | 'settings' | 'account' | 'arrow-right' | 'reload';
