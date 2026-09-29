import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Админка живёт под /admin/ на том же порту, что и API (в проде — бэкенд,
// в dev — проксируем запросы на бэкенд на :8080).
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
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
