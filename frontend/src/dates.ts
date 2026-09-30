const osloDateFormatter = new Intl.DateTimeFormat('en', {
  timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function osloDate(date: Date): string {
  const parts = osloDateFormatter.formatToParts(date);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDays(from: string, count: number): string {
  const date = new Date(`${from}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return dateKey(date);
}

// The API accepts inclusive windows of at most 62 days.
export function visibleDayCount(width: number, nameWidth: number, dayWidth: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(nameWidth) || !Number.isFinite(dayWidth) || dayWidth <= 0) return 1;
  return Math.max(1, Math.min(62, Math.floor((width - nameWidth) / dayWidth)));
}

export function dateWindow(from: string, count: number): { from: string; to: string; label: string } {
  const to = addDays(from, Math.max(1, Math.min(62, Math.floor(count))) - 1);
  const first = new Date(`${from}T12:00:00Z`);
  const last = new Date(`${to}T12:00:00Z`);
  const short = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const full = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const label = from === to ? full.format(first) : `${first.getUTCFullYear() === last.getUTCFullYear() ? short.format(first) : full.format(first)} – ${full.format(last)}`;
  return { from, to, label };
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
