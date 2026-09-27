import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, dateKey, datesInRange, dateWindow, osloDate, visibleDayCount } from '../src/dates.ts';

test('today follows Oslo midnight and daylight saving offsets', () => {
  assert.equal(osloDate(new Date('2026-09-26T22:30:00Z')), '2026-09-27');
  assert.equal(osloDate(new Date('2026-03-29T22:30:00Z')), '2026-03-30');
  assert.equal(osloDate(new Date('2026-10-25T23:30:00Z')), '2026-10-26');
});

test('visible count fits readable columns and respects the API limit', () => {
  for (const width of [273, 358, 720, 900, 1100, 2000, 4000]) {
    const nameWidth = width < 400 ? 140 : 180;
    const count = visibleDayCount(width, nameWidth, 32);
    assert.ok(count >= 1 && count <= 62);
    assert.ok(nameWidth + count * 32 <= width);
    if (count < 62) assert.ok(nameWidth + (count + 1) * 32 > width);
  }
  assert.equal(visibleDayCount(0, 180, 32), 1);
  assert.equal(visibleDayCount(Infinity, 180, 32), 1);
  assert.equal(visibleDayCount(900, 180, 0), 1);
});

test('windows contain precisely the requested start and end, including past dates', () => {
  for (const from of ['2026-08-01', '2026-09-27', '2026-12-27']) {
    const range = dateWindow(from, 39);
    const dates = datesInRange(range.from, range.to);
    assert.equal(dates.length, 39);
    assert.equal(dateKey(dates[0]), from);
    assert.equal(dateKey(dates.at(-1)), addDays(from, 38));
  }
});

test('adjacent windows have no gaps or overlap across months and years', () => {
  const range = dateWindow('2026-09-27', 39);
  assert.equal(range.to, '2026-11-04');
  const next = dateWindow(addDays(range.to, 1), 39);
  assert.equal(next.from, '2026-11-05');
  assert.equal(next.to, '2026-12-13');
  assert.deepEqual(dateWindow(addDays(next.from, -39), 39), range);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
});

test('resizing changes the end without changing the starting date', () => {
  const wide = dateWindow('2026-09-27', visibleDayCount(1428, 180, 32));
  const narrow = dateWindow(wide.from, visibleDayCount(800, 180, 32));
  assert.equal(wide.from, narrow.from);
  assert.ok(narrow.to < wide.to);
});

test('labels describe exact ranges within a month, across months, and across years', () => {
  assert.equal(dateWindow('2026-09-27', 1).label, '27 Sept 2026');
  assert.equal(dateWindow('2026-09-27', 4).label, '27 Sept – 30 Sept 2026');
  assert.equal(dateWindow('2026-09-27', 39).label, '27 Sept – 4 Nov 2026');
  assert.equal(dateWindow('2026-12-27', 10).label, '27 Dec 2026 – 5 Jan 2027');
});
