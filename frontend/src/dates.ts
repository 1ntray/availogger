const osloDateFormatter = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function osloDate(date: Date): string {
  const parts = osloDateFormatter.formatToParts(date);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function monthRange(offset: number, now = new Date()): { from: string; to: string; label: string } {
  const [year, month] = osloDate(now).split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 2, 0));
  const format = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  return { from: dateKey(first), to: dateKey(last), label: `${format.format(first)} – ${format.format(next)}` };
}

export function datesInRange(from: string, to: string): Date[] {
  const dates: Date[] = [];
  const current = new Date(`${from}T12:00:00Z`);
  const last = new Date(`${to}T12:00:00Z`);
  while (current <= last) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function calendarView(from: string, to: string, today: string): { dates: Date[]; dayOffset: number } {
  const dates = datesInRange(from, to);
  const first = dates.findIndex(date => dateKey(date) >= today);
  // Keep the original response index so trimming columns cannot shift statuses.
  return first < 0 ? { dates: [], dayOffset: dates.length } : { dates: dates.slice(first), dayOffset: first };
}
