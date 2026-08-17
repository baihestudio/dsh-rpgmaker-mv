import { isRegularFile } from './files';
import { isAbsolute, join } from 'node:path';
import { pathDelimiter } from './config';

export interface ExecutableLookupOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
}

function looksLikePath(value: string): boolean {
  return isAbsolute(value) || value.includes('/') || value.includes('\\');
}

export async function resolveExecutable(name: string, options: ExecutableLookupOptions = {}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const requested = name.trim();
  if (!requested) return undefined;

  if (looksLikePath(requested)) {
    if (await isRegularFile(requested)) return requested;
    if (platform === 'win32' && !requested.includes('.')) {
      for (const extension of ['.exe', '.cmd', '.bat', '.ps1']) {
        if (await isRegularFile(`${requested}${extension}`)) return `${requested}${extension}`;
      }
    }
    return undefined;
  }

  const entries = (env.PATH ?? '').split(pathDelimiter(platform)).filter(Boolean);
  const names = platform === 'win32'
    ? [requested, `${requested}.exe`, `${requested}.cmd`, `${requested}.bat`, `${requested}.ps1`]
    : [requested];
  for (const entry of entries) {
    for (const candidate of names) {
      const path = join(entry.replace(/^"|"$/g, ''), candidate);
      if (await isRegularFile(path)) return path;
    }
  }
  return undefined;
}
