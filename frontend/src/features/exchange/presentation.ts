export function compactSwapperNames(names: string[]): string {
  const unique = [...new Set(names.filter(Boolean).map(name => name.trim().split(/\s+/)[0]))];
  return unique.length > 2 ? `${unique.slice(0, 2).join(', ')} +${unique.length - 2}` :
    unique.length === 2 ? `${unique[0]} and ${unique[1]}` : unique[0] ?? 'another student';
}
