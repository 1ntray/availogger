import type { AvailabilityResponse } from './types';

export function isAvailabilityResponse(value: unknown): value is AvailabilityResponse {
  return typeof value === 'object' && value !== null &&
    // Pages and the Worker deploy separately. Older Workers have no timestamp;
    // accept their schedules, but reject malformed timestamps when supplied.
    (!('cachedAt' in value) || (typeof value.cachedAt === 'string' &&
      Number.isFinite(Date.parse(value.cachedAt)) && new Date(value.cachedAt).toISOString() === value.cachedAt)) &&
    'instructors' in value && Array.isArray(value.instructors) &&
    value.instructors.every((item: unknown) => typeof item === 'object' && item !== null &&
      'id' in item && typeof item.id === 'string' && 'days' in item && Array.isArray(item.days) &&
      item.days.every((day: unknown) => ['available', 'unavailable', 'undefined'].includes(String(day))));
}
