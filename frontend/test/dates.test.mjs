import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarView, dateKey, monthRange, osloDate } from '../src/dates.ts';

test('today follows Oslo midnight and daylight saving offsets', () => {
  assert.equal(osloDate(new Date('2026-09-26T22:30:00Z')), '2026-09-27');
  assert.equal(osloDate(new Date('2026-03-29T22:30:00Z')), '2026-03-30');
  assert.equal(osloDate(new Date('2026-10-25T23:30:00Z')), '2026-10-26');
});

test('current view starts today and retains the correct availability index', () => {
  const view = calendarView('2026-09-01', '2026-10-31', '2026-09-26');
  assert.equal(dateKey(view.dates[0]), '2026-09-26');
  assert.equal(dateKey(view.dates.at(-1)), '2026-10-31');
  assert.equal(view.dayOffset, 25);
  const statuses = Array(61).fill('unavailable');
  statuses[25] = 'available';
  assert.equal(statuses[view.dayOffset], 'available');
});

test('future views keep their first date and past views have no columns', () => {
  const future = calendarView('2026-10-01', '2026-11-30', '2026-09-26');
  assert.equal(dateKey(future.dates[0]), '2026-10-01');
  assert.equal(future.dayOffset, 0);
  assert.deepEqual(calendarView('2026-08-01', '2026-08-31', '2026-09-26').dates, []);
});

test('month range follows the Oslo month and rolls into the next year', () => {
  assert.deepEqual(monthRange(0, new Date('2026-12-31T23:30:00Z')), {
    from: '2027-01-01', to: '2027-02-28', label: 'January 2027 – February 2027',
  });
});
