import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { buildReleaseZip, inspectReleaseZip, RELEASE_ARCHIVE_NAME } from '../src/release-gate';

const output = resolve(process.argv[2] ?? join(process.cwd(), 'dist', RELEASE_ARCHIVE_NAME));
await mkdir(dirname(output), { recursive: true });
const archive = await buildReleaseZip({ sourceRoot: process.cwd(), outputZip: output });
const inspection = await inspectReleaseZip({ zipPath: archive });
if (!inspection.valid) throw new Error(`Release ZIP is incomplete: ${inspection.missing.join(', ')}`);
console.log(JSON.stringify({ ok: true, archive, entries: inspection.entries.length, required: inspection.requiredEntries }, null, 2));
