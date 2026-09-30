import type { Location } from 'react-router';

export type ReturnLocation = { pathname: string; search: string; hash: string; label: string; returnTo?: ReturnLocation };

const allowed = /^(?:\/|\/duty-ops(?:\/shifts\/[^/]+|\/exchanges)?|\/flyvask(?:\/exchanges)?|\/brakkevakt(?:\/exchanges|\/manage)?|\/admin(?:\/users|\/availability|\/duty-ops\/credits|\/contact(?:\/[^/]+)?|\/exchanges)?|\/messages(?:\/[^/]+)?|\/feedback|\/inbox|\/activity|\/flights|\/settings|\/onboarding)$/;
const safePart = (value: unknown, prefix: string) => typeof value === 'string' &&
  (!value || value.startsWith(prefix)) && !/[\u0000-\u001f\\]/.test(value);
const decodable = (value: string) => { try { decodeURI(value); return true; } catch { return false; } };

export function safeReturnLocation(value: unknown, depth = 0): ReturnLocation | null {
  if (!value || typeof value !== 'object' || depth > 8) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.pathname !== 'string' || !allowed.test(candidate.pathname) ||
    candidate.pathname.startsWith('//') || candidate.pathname.includes('..') ||
    !safePart(candidate.search, '?') || !safePart(candidate.hash, '#') ||
    !decodable(candidate.pathname) || !decodable(candidate.search as string) || !decodable(candidate.hash as string) ||
    typeof candidate.label !== 'string' || !candidate.label.trim() || candidate.label.length > 80) return null;
  const parent = candidate.returnTo === undefined ? null : safeReturnLocation(candidate.returnTo, depth + 1);
  return { pathname: candidate.pathname, search: candidate.search as string, hash: candidate.hash as string,
    label: locationLabel(candidate.pathname), ...(parent ? { returnTo: parent } : {}) };
}

export function locationLabel(pathname: string): string {
  if (pathname === '/') return 'Home';
  if (/^\/duty-ops\/shifts\//.test(pathname)) return 'Duty Ops shift';
  if (/\/exchanges$/.test(pathname)) return 'Exchanges';
  if (/^\/admin\/contact\//.test(pathname)) return 'Contact message';
  if (/^\/messages\//.test(pathname)) return 'Message';
  if (pathname === '/admin/contact') return 'Webmaster messages';
  if (pathname === '/admin/exchanges') return 'Exchange audit';
  if (pathname === '/admin/duty-ops/credits') return 'Duty Ops credit audit';
  if (pathname.startsWith('/admin')) return 'Administration';
  return ({ '/duty-ops': 'Duty Ops', '/flyvask': 'Flyvask', '/brakkevakt': 'Brakkevakt',
    '/messages': 'Messages', '/flights': 'Flights', '/inbox': 'Inbox', '/activity': 'My activity',
    '/brakkevakt/manage': 'Manage Brakkevakt', '/settings': 'Settings', '/onboarding': 'Onboarding',
    '/feedback': 'Feedback' } as Record<string, string>)[pathname] ?? 'Home';
}

export function currentReturnLocation(location: Location): ReturnLocation {
  const parent = safeReturnLocation((location.state as { returnTo?: unknown } | null)?.returnTo);
  return { pathname: location.pathname, search: location.search, hash: location.hash,
    label: locationLabel(location.pathname), ...(parent ? { returnTo: parent } : {}) };
}
