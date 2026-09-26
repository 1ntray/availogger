import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaOptions } from './pwa.config';

export default defineConfig({
  plugins: [react(), VitePWA(pwaOptions)],
  base: '/',
  // Optional Vite development server; production always uses the same-origin API.
  server: { proxy: { '/api': 'http://localhost:8788' } },
});
