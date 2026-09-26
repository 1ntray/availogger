import assert from 'node:assert/strict';
import test from 'node:test';
import { cacheAgeLabel, cacheTimeInOslo } from '../src/cache-age.ts';

test('relative age counts elapsed minutes and hours', () => {
  const cachedAt = '2026-09-26T12:00:00.000Z';
  const start = Date.parse(cachedAt);
  assert.equal(cacheAgeLabel(cachedAt, start), 'Updated just now');
  assert.equal(cacheAgeLabel(cachedAt, start + 60_000), 'Updated 1 minute ago');
  assert.equal(cacheAgeLabel(cachedAt, start + 3_600_000), 'Updated 1 hour ago');
});

test('exact time uses Oslo offsets on both daylight saving transitions', () => {
  assert.match(cacheTimeInOslo('2026-03-29T01:30:00.000Z'), /29 March 2026 at 03:30 CEST/);
  assert.match(cacheTimeInOslo('2026-10-25T01:30:00.000Z'), /25 October 2026 at 02:30 CET/);
});
