import assert from 'node:assert/strict';
import test from 'node:test';
import { availabilityUrl } from '../src/api-url.ts';

test('availability always uses a relative same-origin URL', () => {
  const url = availabilityUrl('2026-09-01', '2026-10-31');
  assert.equal(url, '/api/availability?from=2026-09-01&to=2026-10-31');
  assert.equal(new URL(url, 'https://student.luftfartsfag.no').origin, 'https://student.luftfartsfag.no');
  assert.equal(new URL(url, 'http://localhost:8788').origin, 'http://localhost:8788');
});

test('obsolete production variables cannot select localhost or the old Worker', () => {
  process.env.VITE_API_BASE_URL = 'http://localhost:8787';
  try {
    assert.equal(new URL(availabilityUrl('2026-09-01', '2026-09-02'), 'https://student.luftfartsfag.no').origin,
      'https://student.luftfartsfag.no');
  } finally {
    delete process.env.VITE_API_BASE_URL;
  }
});
