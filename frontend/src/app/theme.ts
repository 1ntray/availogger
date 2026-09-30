import { useEffect, useState } from 'react';

// Keep in sync with the inline theme bootstrap in index.html, which applies the theme before first paint.
export const THEME_STORAGE_KEY = 'portal-theme';
export const THEME_CHANGED_EVENT = 'portal-theme-changed';
export type ThemePreference = 'system' | 'light' | 'dark';

const HEADER_COLOR = { light: '#172833', dark: '#0b161c' } as const;

function darkQuery() {
  return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
}

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch { return 'system'; }
}

export function applyTheme(preference = readThemePreference()) {
  const theme = preference === 'system' ? (darkQuery()?.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', HEADER_COLOR[theme]);
  return theme;
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch { /* Storage can be unavailable; the choice still applies for this page view. */ }
  applyTheme(preference);
  window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
}

export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
  useEffect(() => {
    const sync = () => setPreference(readThemePreference());
    window.addEventListener(THEME_CHANGED_EVENT, sync);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, sync);
  }, []);
  return [preference, (next: ThemePreference) => { setPreference(next); setThemePreference(next); }] as const;
}

/** Follows the operating system setting while the preference is "system". */
export function watchSystemTheme() {
  const query = darkQuery();
  if (!query) return () => {};
  const change = () => { if (readThemePreference() === 'system') applyTheme('system'); };
  query.addEventListener?.('change', change);
  return () => query.removeEventListener?.('change', change);
}
