// Application-defined catalogue. Add permissions explicitly with a D1 migration.
export const PERMISSIONS = {
  availabilityView: 'availability.view',
  dutyOpsView: 'duty_ops.view',
  dutyOpsSwap: 'duty_ops.swap',
  dutyOpsManageSchedule: 'duty_ops.manage_schedule',
  transportView: 'transport.view',
  transportBookUniversityCars: 'transport.book_university_cars',
  transportOfferPrivateRide: 'transport.offer_private_ride',
  transportManageUniversityCars: 'transport.manage_university_cars',
  adminManageUsers: 'admin.manage_users',
  adminManagePermissions: 'admin.manage_permissions',
} as const;
export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS];
export const permissionDefinitions: readonly { key: PermissionKey; description: string; privileged: boolean }[] = [
  { key: PERMISSIONS.availabilityView, description: 'Instructor availability', privileged: false },
  { key: PERMISSIONS.dutyOpsView, description: 'View Duty Ops', privileged: false },
  { key: PERMISSIONS.dutyOpsSwap, description: 'Swap Duty Ops assignments', privileged: false },
  { key: PERMISSIONS.dutyOpsManageSchedule, description: 'Manage Duty Ops schedule', privileged: true },
  { key: PERMISSIONS.transportView, description: 'View Transport', privileged: false },
  { key: PERMISSIONS.transportBookUniversityCars, description: 'Book university cars', privileged: false },
  { key: PERMISSIONS.transportOfferPrivateRide, description: 'Offer private rides', privileged: false },
  { key: PERMISSIONS.transportManageUniversityCars, description: 'Manage university cars', privileged: true },
  { key: PERMISSIONS.adminManageUsers, description: 'Manage users', privileged: true },
  { key: PERMISSIONS.adminManagePermissions, description: 'Manage permissions', privileged: true },
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
  user: { id: string; email: string };
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
