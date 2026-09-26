export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function monthRange(offset: number): { from: string; to: string; label: string } {
  const now = new Date();
  const osloParts = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Oslo', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const year = Number(osloParts.find(part => part.type === 'year')?.value);
  const month = Number(osloParts.find(part => part.type === 'month')?.value) - 1;
  const first = new Date(year, month + offset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 2, 0);
  const format = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });
  const next = new Date(first.getFullYear(), first.getMonth() + 1, 1);
  return { from: isoDate(first), to: isoDate(last), label: `${format.format(first)} – ${format.format(next)}` };
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
