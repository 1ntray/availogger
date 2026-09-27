import { ApplicationError } from './application-error';

export function requireSameOrigin(request: Request, message = 'Submit changes from the student portal.'): void {
  const origin = request.headers.get('Origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new ApplicationError(message, 403, 'CROSS_SITE_REQUEST');
  }
}
