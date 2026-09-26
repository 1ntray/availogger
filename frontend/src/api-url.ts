export function availabilityUrl(from: string, to: string): string {
  const query = new URLSearchParams({ from, to });
  return `/api/availability?${query}`;
}
