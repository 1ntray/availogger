import type { AccessEnv, AccessIdentity } from './access';
import type { AvailabilityEnv } from './availability';

export interface PagesEnv extends AvailabilityEnv, AccessEnv {
  DB?: D1Database;
  FLIGHTLOGGER_CREDENTIAL_ENCRYPTION_KEY?: string;
  PORTAL_BOOTSTRAP_ADMIN_SUBJECT?: string;
}
export interface AccessData extends Record<string, unknown> { accessIdentity: AccessIdentity }
