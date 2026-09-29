/**
 * `vite.config.ts` carries the Vitest block inline (`test: { environment,
 * include }`), which only type-checks when Vitest's own augmentation of
 * Vite's `UserConfig` is in the program. The config file is shared and
 * read-only, so the augmentation is pulled in from here instead of by
 * re-writing it to import `defineConfig` from `vitest/config`.
 *
 * Importing the type also guarantees the block cannot silently drift away
 * from the fields Vitest actually understands.
 */
import type { InlineConfig } from 'vitest/node';

declare module 'vite' {
  interface UserConfig {
    test?: InlineConfig;
  }
}
