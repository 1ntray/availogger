import type { VitePWAOptions } from 'vite-plugin-pwa';

export const pwaOptions: Partial<VitePWAOptions> = {
  strategies: 'injectManifest',
  srcDir: 'src/pwa',
  filename: 'sw.js',
  registerType: 'prompt',
  injectRegister: false,
  useCredentials: true,
  includeManifestIcons: false, // Icons are already covered by the explicit glob.
  injectManifest: { globPatterns: ['assets/**/*.{js,css}', 'icons/*.{svg,png}', 'fonts/*.woff2'] },
  manifest: {
    id: '/', name: 'Luftfartsfag Studentportal', short_name: 'Studentportal',
    description: 'Training and daily operations for Luftfartsfag students.',
    start_url: '/', scope: '/', display: 'standalone', lang: 'en',
    theme_color: '#172833', background_color: '#f5f7f7',
    icons: [
      { src: '/icons/portal-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/portal-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/portal-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
};
