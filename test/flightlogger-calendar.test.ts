import { describe, expect, it } from 'vitest';
import { addDays, buildCalendar, osloMidnight, queryWindow, statusForDay } from '../backend/flightlogger/calendar';

describe('Oslo calendar boundaries', () => {
  it('uses 23 and 25 hour days at DST changes', () => {
    expect((osloMidnight('2026-03-30') - osloMidnight('2026-03-29')) / 3600000).toBe(23);
    expect((osloMidnight('2026-10-26') - osloMidnight('2026-10-25')) / 3600000).toBe(25);
  });

  it('treats periods as half-open and unavailable as dominant', () => {
    const start = osloMidnight('2026-09-26');
    const end = osloMidnight(addDays('2026-09-26', 1));
    expect(statusForDay([{ startsAt: new Date(end).toISOString(), endsAt: new Date(end + 3600000).toISOString(), unavailable: false }], start, end)).toBe('undefined');
    expect(statusForDay([
      { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), unavailable: false },
      { startsAt: new Date(start + 3600000).toISOString(), endsAt: new Date(start + 7200000).toISOString(), unavailable: true },
    ], start, end)).toBe('unavailable');
  });

  it('builds one status per requested date', () => {
    const result = buildCalendar('2026-09-26', '2026-09-27', [{ instructor: { id: '1', firstName: 'Ada', lastName: 'L', callSign: '' }, periods: [] }]);
    expect(result.instructors[0].days).toEqual(['undefined', 'undefined']);
  });

  it('pads the query using Oslo midnights across clock changes', () => {
    expect(queryWindow('2026-03-29', '2026-03-29')).toEqual({
      from: '2025-12-28T23:00:00.000Z',
      to: '2026-06-27T22:00:00.000Z',
    });
    expect(queryWindow('2026-10-25', '2026-10-25')).toEqual({
      from: '2026-07-26T22:00:00.000Z',
      to: '2027-01-23T23:00:00.000Z',
    });
  });
});
