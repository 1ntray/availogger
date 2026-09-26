import type { AvailabilityPeriod, AvailabilityResult, AvailabilityStatus, Instructor } from './types';

const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', timeZoneName: 'shortOffset' });
const DAY = 86400000;

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function osloMidnight(iso: string): number {
  // At 00:00 UTC, Norway is still on the same offset as that date's local
  // midnight, including on its spring and autumn clock-change dates.
  const midnightUtc = new Date(`${iso}T00:00:00Z`);
  const name = zone.formatToParts(midnightUtc).find(part => part.type === 'timeZoneName')?.value || '';
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
  if (!match) throw new Error('Could not determine Europe/Oslo time offset.');
  const minutes = (Number(match[2]) * 60 + Number(match[3] || 0)) * (match[1] === '+' ? 1 : -1);
  return Date.parse(`${iso}T00:00:00Z`) - minutes * 60000;
}

export function statusForDay(periods: AvailabilityPeriod[], dayStart: number, dayEnd: number): AvailabilityStatus {
  let available = false;
  for (const period of periods) {
    if (Date.parse(period.startsAt) < dayEnd && Date.parse(period.endsAt) > dayStart) {
      if (period.unavailable) return 'unavailable';
      available = true;
    }
  }
  return available ? 'available' : 'undefined';
}

export function buildCalendar(from: string, to: string, records: { instructor: Instructor; periods: AvailabilityPeriod[] }[]): AvailabilityResult {
  const days: { start: number; end: number }[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    days.push({ start: osloMidnight(date), end: osloMidnight(addDays(date, 1)) });
  }
  return {
    from, to, timeZone: 'Europe/Oslo',
    instructors: records.map(({ instructor, periods }) => ({
      ...instructor,
      days: days.map(day => statusForDay(periods, day.start, day.end)),
    })).sort((a, b) => (a.callSign || `${a.firstName} ${a.lastName}`).localeCompare(b.callSign || `${b.firstName} ${b.lastName}`)),
  };
}

export function queryWindow(from: string, to: string): { from: string; to: string } {
  // FlightLogger documents start-after and end-before filters, but no overlap
  // filter for availabilities. Padding catches common spanning periods; a period
  // crossing either padded boundary can still be missed.
  return {
    from: new Date(osloMidnight(addDays(from, -90))).toISOString(),
    to: new Date(osloMidnight(addDays(to, 91))).toISOString(),
  };
}

export function inclusiveDayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
}
