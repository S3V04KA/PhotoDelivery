/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Скачивания идут на тот же бэкенд, что и API: в проде бэкенд отдаёт и этот
  // бандл, поэтому /api остаётся same-origin, а в dev проксируется на :8080.
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    reportCompressedSize: true,
  },
});
