import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { pwaOptions } from '../pwa.config';

describe('PWA assets and authentication boundaries', () => {
  it('defines a standalone same-origin portal manifest with install icons', () => {
    const manifest = pwaOptions.manifest;
    expect(manifest).toMatchObject({ name: 'Luftfartsfag Studentportal', short_name: 'Studentportal', start_url: '/', scope: '/', display: 'standalone' });
    if (!manifest) throw new Error('Missing manifest');
    for (const icon of manifest.icons || []) {
      const bytes = readFileSync(`public${icon.src}`);
      expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
      const [width,height] = icon.sizes!.split('x').map(Number);
      expect(bytes.readUInt32BE(16)).toBe(width); expect(bytes.readUInt32BE(20)).toBe(height);
    }
    expect(manifest.icons?.some(icon => icon.purpose === 'maskable')).toBe(true);
    expect(pwaOptions.useCredentials).toBe(true);
  });
  it('precaches only static assets, preserving network navigation and API calls', () => {
    expect(pwaOptions.injectManifest?.globPatterns).toEqual(['assets/**/*.{js,css}', 'icons/*.{svg,png}']);
    const sw = readFileSync('src/pwa/sw.js','utf8');
    expect(sw).toContain('precacheAndRoute(self.__WB_MANIFEST)');
    expect(sw).not.toMatch(/registerRoute|NavigationRoute|requestPermission|pushManager|caches\.put/);
    const routes = JSON.parse(readFileSync('public/_routes.json','utf8'));
    expect(routes.include).toContain('/api/*');
    expect(readFileSync('src/api-url.ts','utf8')).not.toContain('VITE_API_BASE_URL');
    expect(readFileSync('src/app/current-user-api.ts','utf8')).not.toContain('VITE_API_BASE_URL');
    const credentialApi = readFileSync('src/features/flightlogger/credential-api.ts', 'utf8');
    expect(credentialApi).toContain("fetch('/api/onboarding/flightlogger'");
    expect(credentialApi).toContain("cache: 'no-store'");
    for (const file of ['src/features/flightlogger/CredentialForm.tsx', 'src/features/flightlogger/credential-api.ts']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\.|console\./);
    }
  });
});
