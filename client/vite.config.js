import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Per-project values injected by CloneProject's run.js (with sensible fallbacks).
const PORT = Number(process.env.VITE_PORT) || 5178;
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    host: '0.0.0.0',
    port: PORT,
    strictPort: true, // use the assigned port or fail loudly (don't silently drift)
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
});
