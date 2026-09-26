/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: the SPA calls same-origin "/api/v1/..." and Vite forwards it to the local
// FastAPI backend, so no CORS config is needed on the backend.
// Tunnels used to share the dev build (ngrok free/paid domains). Leading dot = any subdomain.
const allowedHosts = ['.ngrok-free.app', '.ngrok.app', '.ngrok.io'];

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
  preview: { allowedHosts },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // user-event-driven screen tests take 0.5–5 s in jsdom; under CPU load (parallel runs, CI)
    // the 5 s default made them time out. Assertions are unaffected.
    testTimeout: 20_000,
  },
});
