import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface CredentialMetadata {
  configured: boolean;
  source: 'environment' | 'local-file' | 'missing';
  path: string;
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function inspectCredentialMetadata(dshHome: string, env: Record<string, string | undefined>): Promise<CredentialMetadata> {
  const path = join(dshHome, '.credentials.yaml');
  const envConfigured = typeof env.DEEPSEEK_API_KEY === 'string' && env.DEEPSEEK_API_KEY.length > 0;
  if (envConfigured) return { configured: true, source: 'environment', path };
  if (await isRegularFile(path)) return { configured: true, source: 'local-file', path };
  return { configured: false, source: 'missing', path };
}
