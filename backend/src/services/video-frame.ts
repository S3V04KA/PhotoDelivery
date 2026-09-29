import { spawn } from 'node:child_process';

const FFMPEG_TIMEOUT_MS = 60_000;
const SYSTEM_FFMPEG = 'ffmpeg';

let binaryPromise: Promise<string> | null = null;

export function resolveFfmpegBinary(): Promise<string> {
  binaryPromise ??= import('ffmpeg-static')
    .then((module) => {
      const bundled = module.default;
      return typeof bundled === 'string' && bundled.length > 0 ? bundled : SYSTEM_FFMPEG;
    })
    .catch(() => SYSTEM_FFMPEG);
  return binaryPromise;
}

export function qualityScale(quality: number): number {
  const span = 3 + Math.round(((100 - quality) / 99) * 5);
  return Math.min(8, Math.max(3, span));
}

export interface FfmpegOptions {
  readonly timeoutMs: number;
}

export async function runFfmpeg(
  binary: string,
  args: readonly string[],
  options: FfmpegOptions = { timeoutMs: FFMPEG_TIMEOUT_MS },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: 'ignore' });
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
    }, options.timeoutMs);
    child.once('error', (error) => {
      clearTimeout(killer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(killer);
      resolve(code ?? -1);
    });
  });
}
