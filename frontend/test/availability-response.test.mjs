import assert from 'node:assert/strict';
import test from 'node:test';
import { isAvailabilityResponse } from '../src/availability-response.ts';

const schedule = {
  from: '2026-09-01', to: '2026-10-31', timeZone: 'Europe/Oslo',
  instructors: [{ id: '1', firstName: 'Test', lastName: '', callSign: '', days: ['available'] }],
};

test('accepts schedules from both Worker deployment versions', () => {
  assert.equal(isAvailabilityResponse(schedule), true);
  assert.equal(isAvailabilityResponse({ ...schedule, cachedAt: '2026-09-26T12:00:00.000Z' }), true);
});

test('rejects invalid supplied timestamps and malformed schedules', () => {
  for (const cachedAt of [null, 123, 'invalid', '2026-09-26']) {
    assert.equal(isAvailabilityResponse({ ...schedule, cachedAt }), false);
  }
  assert.equal(isAvailabilityResponse({ ...schedule, instructors: [{ id: '1', days: ['wrong'] }] }), false);
});
