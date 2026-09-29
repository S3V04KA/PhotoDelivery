import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const BACKEND_ROOT = path.resolve(here, '..', '..');
export const MONOREPO_ROOT = path.resolve(BACKEND_ROOT, '..');

export function distDirOf(packageName: 'front' | 'admin-panel'): string {
  return path.join(MONOREPO_ROOT, packageName, 'dist');
}
