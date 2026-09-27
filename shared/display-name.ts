export interface NamedUser { firstName?: string | null; lastName?: string | null }
export function displayName(user: NamedUser, fallback = 'Student'): string {
  return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || fallback;
}
