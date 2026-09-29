import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Тесты с реальными sharp/ffmpeg дольше 10с не идут; запас на холодный старт.
    testTimeout: 30_000,
  },
});
