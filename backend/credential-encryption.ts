import { ApplicationError } from './application-error';

export const ENCRYPTION_VERSION = 1;
export const MAX_API_KEY_LENGTH = 4096;
export type EncryptedCredential = { token_ciphertext: string; token_iv: string; encryption_version: number };
const encoder = new TextEncoder();

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function decode(value: string, maxLength: number): Uint8Array<ArrayBuffer> {
  if (!value || value.length > maxLength || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid encoding');
  const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  if (encode(bytes) !== value) throw new Error('Invalid encoding');
  return bytes;
}

export function validateEncryptionSecret(secret: string | undefined): Uint8Array<ArrayBuffer> {
  try {
    const bytes = decode(secret || '', 44);
    if (bytes.length !== 32) throw new Error('Invalid key length');
    return bytes;
  } catch {
    throw new ApplicationError('FlightLogger credential encryption is not configured. Contact the portal administrator.', 503);
  }
}

async function importKey(secret: string | undefined): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', validateEncryptionSecret(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function aad(userId: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(`studentportal:flightlogger:v${ENCRYPTION_VERSION}:${userId}`));
}

export async function encryptCredential(token: string, userId: string, secret: string | undefined): Promise<EncryptedCredential> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(userId), tagLength: 128 }, key, encoder.encode(token));
  return { token_ciphertext: encode(new Uint8Array(ciphertext)), token_iv: encode(iv), encryption_version: ENCRYPTION_VERSION };
}

export async function decryptCredential(credential: EncryptedCredential, userId: string, secret: string | undefined): Promise<string> {
  const key = await importKey(secret);
  try {
    if (credential.encryption_version !== ENCRYPTION_VERSION) throw new Error('Unsupported version');
    const iv = decode(credential.token_iv, 16);
    const ciphertext = decode(credential.token_ciphertext, 5500);
    if (iv.length !== 12 || ciphertext.length < 17) throw new Error('Invalid ciphertext');
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(userId), tagLength: 128 }, key, ciphertext);
    const token = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (!/^[\x21-\x7E]+$/.test(token) || token.length > MAX_API_KEY_LENGTH) throw new Error('Invalid credential');
    return token;
  } catch {
    throw new ApplicationError('Your FlightLogger connection could not be read. Replace the API key in Settings, or contact the portal administrator.', 503);
  }
}
