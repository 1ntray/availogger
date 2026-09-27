import { ApplicationError } from './application-error';
import { decryptCredential, encryptCredential, validateEncryptionSecret, type EncryptedCredential } from './credential-encryption';
import { FlightLoggerClient, FlightLoggerError } from './flightlogger/client';
import type { ApplicationUser } from './users';

export async function hasFlightLoggerCredential(db: D1Database, userId: string): Promise<boolean> {
  return !!await db.prepare('SELECT 1 AS present FROM flightlogger_credentials WHERE user_id = ?').bind(userId).first();
}

// Plaintext is returned only inside the backend, never from a route.
export async function getFlightLoggerCredential(db: D1Database, userId: string, secret: string | undefined): Promise<string> {
  validateEncryptionSecret(secret);
  const stored = await db.prepare('SELECT token_ciphertext, token_iv, encryption_version FROM flightlogger_credentials WHERE user_id = ?')
    .bind(userId).first<EncryptedCredential>();
  if (!stored) throw new ApplicationError('Connect your FlightLogger account before loading availability.', 409, 'ONBOARDING_REQUIRED');
  return decryptCredential(stored, userId, secret);
}

// Connect and replace share validation and a single atomic write. Invalid replacements
// never overwrite the existing credential or FlightLogger user ID.
export async function storeFlightLoggerCredential(db: D1Database, user: ApplicationUser, token: string, secret: string | undefined): Promise<{ connected: true; flightLoggerUserId: string }> {
  validateEncryptionSecret(secret);
  let current: { id: string };
  try {
    current = await new FlightLoggerClient(token).currentUser();
  } catch (cause) {
    if (cause instanceof FlightLoggerError && cause.status === 429) {
      throw new ApplicationError('FlightLogger is rate limiting verification. Try again shortly.', 429, undefined, cause.retryAfterSeconds);
    }
    if (cause instanceof FlightLoggerError && (cause.status === 422 || cause.authenticationFailed)) {
      throw new ApplicationError('The FlightLogger API key could not be verified.', 422);
    }
    throw new ApplicationError('FlightLogger could not verify the connection. Try again shortly.', 503);
  }
  const encrypted = await encryptCredential(token, user.id, secret);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`DELETE FROM duty_ops_assignments WHERE user_id = ? AND EXISTS (
      SELECT 1 FROM users WHERE id = ? AND flightlogger_user_id IS NOT ?)`)
      .bind(user.id, user.id, current.id),
    db.prepare('DELETE FROM duty_ops_sync_state WHERE user_id = ?').bind(user.id),
    db.prepare(`UPDATE users SET
      flightlogger_first_name = CASE WHEN flightlogger_user_id = ? THEN flightlogger_first_name ELSE NULL END,
      flightlogger_last_name = CASE WHEN flightlogger_user_id = ? THEN flightlogger_last_name ELSE NULL END,
      flightlogger_user_id = ?, updated_at = ? WHERE id = ?`).bind(current.id, current.id, current.id, now, user.id),
    db.prepare(`INSERT INTO flightlogger_credentials (user_id, token_ciphertext, token_iv, encryption_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET token_ciphertext = excluded.token_ciphertext,
        token_iv = excluded.token_iv, encryption_version = excluded.encryption_version, updated_at = excluded.updated_at`)
      .bind(user.id, encrypted.token_ciphertext, encrypted.token_iv, encrypted.encryption_version, now, now),
  ]);
  return { connected: true, flightLoggerUserId: current.id };
}
