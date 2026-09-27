import type { AccessUpdate, PermissionKey, RoleKey, UserAccess } from '../../../../shared/authorization';

export interface PortalUser { id: string; email: string; firstName: string | null; lastName: string | null; roles: RoleKey[]; permissions: PermissionKey[] }
export interface AccessCatalogue {
  permissions: { key: PermissionKey; description: string; privileged: boolean }[];
  roles: { key: RoleKey; name: string; permissions: PermissionKey[] }[];
}
async function adminRequest<T>(path: string, signal: AbortSignal, update?: AccessUpdate): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal,
      ...(update ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) } : {}),
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new Error('Could not reach the portal. Try again.');
  }
  const body = await response.json().catch(() => null);
  if (response.redirected || response.status === 401) throw new Error('Reload the page to sign in again.');
  if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'Access could not be loaded or saved.');
  if (!body || typeof body !== 'object') throw new Error('The portal returned an unexpected response.');
  return body as T;
}
export const loadPortalUsers = (signal: AbortSignal) => adminRequest<{ users: PortalUser[] }>('/api/admin/users', signal);
export const loadAccessCatalogue = (signal: AbortSignal) => adminRequest<AccessCatalogue>('/api/admin/permissions', signal);
export const loadUserAccess = (id: string, signal: AbortSignal) => adminRequest<UserAccess>(`/api/admin/users/${encodeURIComponent(id)}/access`, signal);
export const saveUserAccess = (id: string, update: AccessUpdate, signal: AbortSignal) => adminRequest<UserAccess>(`/api/admin/users/${encodeURIComponent(id)}/access`, signal, update);
