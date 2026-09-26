import { ApplicationError } from './application-error';
import { MAX_API_KEY_LENGTH } from './credential-encryption';

export async function readCredentialRequest(request: Request): Promise<string> {
  const origin = request.headers.get('Origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new ApplicationError('Submit the connection from the student portal.', 403);
  }
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApplicationError('Submit the API key as JSON.', 415);
  }
  if (new URL(request.url).search) throw new ApplicationError('Credential submission does not accept query parameters.', 400);
  const maxBodyBytes = 8192;
  if (Number(request.headers.get('Content-Length')) > maxBodyBytes) throw new ApplicationError('The submitted API key is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApplicationError('Enter a FlightLogger API key.', 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBodyBytes) {
        await reader.cancel();
        throw new ApplicationError('The submitted API key is too large.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
  catch { throw new ApplicationError('Submit a valid API key request.', 400); }
  if (typeof body !== 'object' || !body || Array.isArray(body) || Object.keys(body).length !== 1 || !('apiKey' in body) || typeof body.apiKey !== 'string') {
    throw new ApplicationError('Submit only a FlightLogger API key.', 400);
  }
  const token = body.apiKey.trim(); // Copy/paste whitespace is not part of a Bearer token.
  if (!token || token.length > MAX_API_KEY_LENGTH || !/^[\x21-\x7E]+$/.test(token)) throw new ApplicationError('Enter a valid FlightLogger API key.', 400);
  return token;
}
