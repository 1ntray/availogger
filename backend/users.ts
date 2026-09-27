import type { AccessIdentity } from './access';
import { ApplicationError } from './application-error';

export interface ApplicationUser {
  id: string;
  access_subject: string;
  email: string;
  flightlogger_user_id: string | null;
  flightlogger_first_name: string | null;
  flightlogger_last_name: string | null;
  created_at: string;
  updated_at: string;
}

export async function resolveApplicationUser(db: D1Database, identity: AccessIdentity): Promise<ApplicationUser> {
  const existing = await db.prepare('SELECT * FROM users WHERE access_subject = ?').bind(identity.subject).first<ApplicationUser>();
  if (existing?.email === identity.email) return existing;
  const now = new Date().toISOString();
  // The unique subject and UPSERT also handle simultaneous first requests.
  const user = await db.prepare(`
    INSERT INTO users (id, access_subject, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(access_subject) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at
    RETURNING *
  `).bind(crypto.randomUUID(), identity.subject, identity.email, now, now).first<ApplicationUser>();
  if (!user) throw new ApplicationError('The student portal account could not be resolved.', 503);
  return user;
}
