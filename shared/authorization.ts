// Application-defined catalogue. Add permissions explicitly with a D1 migration.
export const PERMISSIONS = {
  availabilityView: 'availability.view',
  dutyOpsView: 'duty_ops.view',
  dutyOpsSwap: 'duty_ops.swap',
  dutyOpsManageSchedule: 'duty_ops.manage_schedule',
  flyvaskView: 'flyvask.view',
  flyvaskSwap: 'flyvask.swap',
  brakkevaktView: 'brakkevakt.view',
  brakkevaktSwap: 'brakkevakt.swap',
  brakkevaktManageSchedule: 'brakkevakt.manage_schedule',
  flightsView: 'flights.view',
  fuelRequest: 'fuel.request',
  adminManageUsers: 'admin.manage_users',
  adminManagePermissions: 'admin.manage_permissions',
  contactWebmasterManage: 'contact.webmaster.manage',
} as const;
export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS];
export const permissionDefinitions: readonly { key: PermissionKey; description: string; privileged: boolean }[] = [
  { key: PERMISSIONS.availabilityView, description: 'Instructor availability', privileged: false },
  { key: PERMISSIONS.dutyOpsView, description: 'View Duty Ops', privileged: false },
  { key: PERMISSIONS.dutyOpsSwap, description: 'Swap Duty Ops assignments', privileged: false },
  { key: PERMISSIONS.dutyOpsManageSchedule, description: 'Manage Duty Ops schedule', privileged: true },
  { key: PERMISSIONS.flyvaskView, description: 'View Flyvask', privileged: false },
  { key: PERMISSIONS.flyvaskSwap, description: 'Swap Flyvask assignments', privileged: false },
  { key: PERMISSIONS.brakkevaktView, description: 'View Brakkevakt', privileged: false },
  { key: PERMISSIONS.brakkevaktSwap, description: 'Swap Brakkevakt assignments', privileged: false },
  { key: PERMISSIONS.brakkevaktManageSchedule, description: 'Manage Brakkevakt schedule', privileged: true },
  { key: PERMISSIONS.flightsView, description: 'View own flights', privileged: false },
  { key: PERMISSIONS.fuelRequest, description: 'Request fuel for own flights', privileged: false },
  { key: PERMISSIONS.adminManageUsers, description: 'Manage users', privileged: true },
  { key: PERMISSIONS.adminManagePermissions, description: 'Manage permissions', privileged: true },
  { key: PERMISSIONS.contactWebmasterManage, description: 'Manage webmaster contact messages', privileged: true },
];
export const ROLE_KEYS = ['ADMIN', 'STUDENT'] as const;
export type RoleKey = typeof ROLE_KEYS[number];
export type OverrideEffect = 'ALLOW' | 'DENY';
export type PermissionOverrides = Partial<Record<PermissionKey, OverrideEffect>>;
export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === 'string' && permissionDefinitions.some(permission => permission.key === value);
}
export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === 'string' && ROLE_KEYS.some(role => role === value);
}
export interface UserAccess {
  user: { id: string; email: string; firstName: string | null; lastName: string | null };
  roles: RoleKey[];
  permissions: PermissionKey[];
  inheritedPermissions: PermissionKey[];
  overrides: PermissionOverrides;
  revision: number;
}
export interface AccessUpdate {
  roles: RoleKey[];
  overrides: PermissionOverrides;
  revision: number;
}
