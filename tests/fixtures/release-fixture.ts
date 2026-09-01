import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INSTALLER_BUILD_EVIDENCE_NAME,
  INSTALLER_EXECUTABLE_NAME,
  RELEASE_ENTRIES,
} from '../../src/release-gate';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Create a disposable Release tree with synthetic generated maintenance files. */
export async function releaseFixture(root: string): Promise<string> {
  const releaseRoot = join(root, 'release fixture');
  await mkdir(releaseRoot, { recursive: true });
  for (const entry of RELEASE_ENTRIES) {
    await cp(join(REPOSITORY_ROOT, entry), join(releaseRoot, entry), { recursive: true });
  }
  await writeFile(join(releaseRoot, INSTALLER_EXECUTABLE_NAME), 'synthetic installer executable\n');
  await writeFile(join(releaseRoot, INSTALLER_BUILD_EVIDENCE_NAME), '{"fixture":true}\n');
  return releaseRoot;
}
