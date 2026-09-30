// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readThemePreference, setThemePreference, THEME_STORAGE_KEY, watchSystemTheme } from '../src/app/theme';

let systemDark = false;
const listeners = new Set<() => void>();
beforeEach(() => {
  systemDark = false; listeners.clear(); localStorage.clear();
  document.head.innerHTML = '<meta name="theme-color" content="#172833">';
  vi.stubGlobal('matchMedia', () => ({ get matches() { return systemDark; }, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }));
});
afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.theme; });
const themeColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

describe('theme preference', () => {
  it('follows the system setting by default', () => {
    systemDark = true;
    expect(readThemePreference()).toBe('system');
    expect(applyTheme()).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(themeColor()).toBe('#0b161c');
  });

  it('stores an explicit choice and clears it again for system', () => {
    setThemePreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    setThemePreference('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(themeColor()).toBe('#172833');
  });

  it('only reacts to system changes while the preference is system', () => {
    const stop = watchSystemTheme();
    applyTheme();
    systemDark = true; listeners.forEach(listener => listener());
    expect(document.documentElement.dataset.theme).toBe('dark');
    setThemePreference('light');
    listeners.forEach(listener => listener());
    expect(document.documentElement.dataset.theme).toBe('light');
    stop();
    expect(listeners.size).toBe(0);
  });

  it('ignores unknown stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readThemePreference()).toBe('system');
  });
});
