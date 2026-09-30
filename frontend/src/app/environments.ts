// Deployed portal hosts. Production serves `master`; development serves `develop` against the preview database.
export const PRODUCTION_ORIGIN = 'https://student.luftfartsfag.no';
// Pages branch alias for `develop`. Switch to https://dev.student.luftfartsfag.no once that custom domain is active.
export const DEVELOPMENT_ORIGIN = 'https://develop-6vlt.availogger.pages.dev';
const DEVELOPMENT_HOSTS = new Set([new URL(DEVELOPMENT_ORIGIN).hostname, 'dev.student.luftfartsfag.no']);

export type PortalEnvironmentLink = { label: string; description: string; href: string };

/** The other deployment an admin can switch to from this host. */
export function otherEnvironment(hostname: string): PortalEnvironmentLink {
  if (DEVELOPMENT_HOSTS.has(hostname)) {
    return { label: 'Open production portal', description: 'You are on the development build.', href: `${PRODUCTION_ORIGIN}/` };
  }
  return { label: 'Open development build', description: 'Preview the latest develop build. It uses its own database, so FlightLogger is connected separately there.', href: `${DEVELOPMENT_ORIGIN}/` };
}
