import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Reads .env / .env.local (all keys, not only VITE_*) so the dev proxy sends your SEC_USER_AGENT.
  // Nothing from here is bundled into the client build.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const secUa = (env.SEC_USER_AGENT || '').trim() || 'AI-Infra-Terminal/1.0 your-email@example.com';
  const host = (env.HOST || '').trim() || '127.0.0.1';
  return {
    plugins: [react()],
    server: {
      host,
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
        // Must precede '/api/sec' (prefix match). Dev only — user-companies / grokbot / bot endpoints need server.mjs or serve.py.
        '/api/sec-www': {
          target: 'https://www.sec.gov',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/sec-www/, ''),
          headers: { 'User-Agent': secUa },
        },
        '/api/sec': {
          target: 'https://data.sec.gov',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/sec/, ''),
          headers: { 'User-Agent': secUa },
        },
      },
    },
    preview: {
      host,
      port: Number(env.PORT || 4173),
    },
  };
});
