import { OnboardingRequiredError } from '../../api';
import type { DutyOpsData } from './types';

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const time = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const name = (v: unknown) => v === null || typeof v === 'string';
const participants = (v: unknown): v is {userId:string;firstName:string|null;lastName:string|null;isCurrentUser:boolean}[] =>
  Array.isArray(v) && v.every(p => object(p) && typeof p.userId === 'string' && name(p.firstName) && name(p.lastName) && typeof p.isCurrentUser === 'boolean');
const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const integrity = (v: unknown) => object(v) && ['CONSISTENT', 'PARTIAL', 'CONFLICT'].includes(v.status as string) &&
  (v.reason === null || ['IDENTITIES_INCOMPLETE', 'RAW_IDENTITY_OVERCOUNT', 'PORTAL_SOURCE_DIVERGED', 'PORTAL_LINEAGE_UNVERIFIED'].includes(v.reason as string));
export function isDutyOpsData(value: unknown): value is DutyOpsData {
  if (!object(value) || typeof value.from !== 'string' || typeof value.to !== 'string' || value.timeZone !== 'Europe/Oslo' || !Array.isArray(value.shifts) || !object(value.sync)) return false;
  const sync = value.sync;
  if (typeof sync.stale !== 'boolean' || !name(sync.warning)) return false;
  for (const s of [sync.discovery, sync.assignments]) if (!object(s) || !time(s.lastSyncedAt) || typeof s.stale !== 'boolean' || !time(s.from) || !time(s.to)) return false;
  return value.shifts.every(s => object(s) && typeof s.id === 'string' && time(s.startsAt) && time(s.endsAt) && Date.parse(s.startsAt as string) < Date.parse(s.endsAt as string) &&
    ['OPEN', 'CANCELLED', 'COMPLETED', 'PARTIALLY_COMPLETED'].includes(s.status as string) && count(s.participantCount) && participants(s.participants) && s.participants.length <= (s.participantCount as number) &&
    (s.participantIntegrity === undefined || integrity(s.participantIntegrity)) &&
    (s.isCurrentUserAssigned === undefined || typeof s.isCurrentUserAssigned === 'boolean') &&
    ((s.flightlogger === undefined && s.assignmentsDiffer === undefined) ||
      (typeof s.assignmentsDiffer === 'boolean' && object(s.flightlogger) && count(s.flightlogger.participantCount) && participants(s.flightlogger.participants) && s.flightlogger.participants.length <= (s.flightlogger.participantCount as number))));
}
export async function loadDutyOps(signal: AbortSignal): Promise<DutyOpsData> {
  let response: Response;
  try { response = await fetch('/api/duty-ops', { signal, credentials: 'same-origin', cache: 'no-store' }); }
  catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new Error('Could not reach Duty Ops. Check your connection and try again.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 403 && object(body) && body.code === 'FORBIDDEN') throw new Error('You do not have access to Duty Ops.');
  if (response.status === 401 || response.status === 403 || response.redirected) throw new Error('Your Access session may have expired. Reload the page to sign in again.');
  if (response.status === 409 && object(body) && body.code === 'ONBOARDING_REQUIRED') throw new OnboardingRequiredError('Connect FlightLogger in Settings.');
  if (!response.ok) throw new Error(object(body) && typeof body.error === 'string' ? body.error : 'Duty Ops could not be loaded. Try again shortly.');
  if (!isDutyOpsData(body)) throw new Error('Duty Ops returned an unexpected response.');
  return body;
}
