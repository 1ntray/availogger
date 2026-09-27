const wallFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function osloInput(iso: string): string {
  const parts = Object.fromEntries(wallFormatter.formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
// Enumerate Oslo offsets and round-trip the wall clock. Gaps return no candidates;
// the autumn repeated hour returns both instants for an explicit user choice.
export function osloInstants(wall: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) return [];
  const naive = Date.parse(`${wall}:00.000Z`);
  if (!Number.isFinite(naive)) return [];
  return [120, 60].map(offset => new Date(naive - offset * 60000).toISOString()).filter(iso => osloInput(iso) === wall).sort();
}
export function nextDeparture(): { wall: string; occurrence: number } {
  const instant = new Date(Math.ceil((Date.now() + 60000) / 600000) * 600000).toISOString();
  const wall = osloInput(instant);
  return { wall, occurrence: osloInstants(wall).indexOf(instant) };
}
export function osloTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
export function osloOffset(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', timeZoneName: 'longOffset' }).formatToParts(new Date(iso)).find(part => part.type === 'timeZoneName')!.value;
}
