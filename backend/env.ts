import type { AccessEnv, AccessIdentity } from './access';
import type { AvailabilityEnv } from './availability';

export interface PagesEnv extends AvailabilityEnv, AccessEnv {}
export interface AccessData extends Record<string, unknown> { accessIdentity: AccessIdentity }
