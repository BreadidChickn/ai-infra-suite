import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/yahoo/, ''),
      },
      '/api/news': {
        target: 'https://news.google.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/news/, ''),
      },
      // Must precede '/api/sec' (prefix match). Dev only — user-companies / grokbot endpoints need server.mjs or serve.py.
      '/api/sec-www': {
        target: 'https://www.sec.gov',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/sec-www/, ''),
        headers: { 'User-Agent': 'AI-Infra-Terminal/1.0 contact@example.com' },
      },
      '/api/sec': {
        target: 'https://data.sec.gov',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/sec/, ''),
        headers: { 'User-Agent': 'AI-Infra-Terminal/1.0 contact@example.com' },
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
});
