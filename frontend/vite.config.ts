import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  // Optional Vite development server; production always uses the same-origin API.
  server: { proxy: { '/api': 'http://localhost:8788' } },
});
