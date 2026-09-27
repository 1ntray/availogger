import { isPermissionKey, isRoleKey, type PermissionKey, type RoleKey } from '../../../shared/authorization';

export type CurrentUser = {
  email: string;
  subject: string;
  firstName?: string | null;
  lastName?: string | null;
  onboardingComplete: boolean;
  hasFlightLoggerCredential: boolean;
  flightLoggerUserId: string | null;
  permissions: PermissionKey[];
  roles: RoleKey[];
};

export async function loadCurrentUser(signal: AbortSignal): Promise<CurrentUser> {
  let response: Response;
  try {
    response = await fetch('/api/me', { signal, credentials: 'same-origin', cache: 'no-store' });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new Error('Could not load your account. Check your connection, or reload the page to sign in again.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403 || response.redirected) {
    throw new Error('Your Access session may have expired. Reload the page to sign in again.');
  }
  if (!response.ok) throw new Error('Your account could not be loaded. Try again shortly.');
  if (typeof body !== 'object' || body === null || !('email' in body) || !('subject' in body) ||
      typeof body.email !== 'string' || !body.email || typeof body.subject !== 'string' || !body.subject ||
      !('firstName' in body) || (body.firstName !== null && typeof body.firstName !== 'string') ||
      !('lastName' in body) || (body.lastName !== null && typeof body.lastName !== 'string') ||
      !('onboardingComplete' in body) || typeof body.onboardingComplete !== 'boolean' ||
      !('hasFlightLoggerCredential' in body) || typeof body.hasFlightLoggerCredential !== 'boolean' ||
      body.onboardingComplete !== body.hasFlightLoggerCredential ||
      !('flightLoggerUserId' in body) || (body.flightLoggerUserId !== null && typeof body.flightLoggerUserId !== 'string') ||
      !('permissions' in body) || !Array.isArray(body.permissions) || !body.permissions.every(isPermissionKey) ||
      !('roles' in body) || !Array.isArray(body.roles) || !body.roles.every(isRoleKey)) {
    throw new Error('The account service returned an unexpected response.');
  }
  return { email: body.email, subject: body.subject, firstName: body.firstName, lastName: body.lastName, onboardingComplete: body.onboardingComplete,
    hasFlightLoggerCredential: body.hasFlightLoggerCredential, flightLoggerUserId: body.flightLoggerUserId,
    permissions: body.permissions, roles: body.roles };
}
