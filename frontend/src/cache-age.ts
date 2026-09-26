const osloTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Oslo',
  year: 'numeric', month: 'long', day: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
});

export function cacheTimeInOslo(cachedAt: string): string {
  return `Fetched ${osloTime.format(new Date(cachedAt))} (Europe/Oslo)`;
}

export function cacheAgeLabel(cachedAt: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(cachedAt)) / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `Updated ${hours} hour${hours === 1 ? '' : 's'} ago`;
}
