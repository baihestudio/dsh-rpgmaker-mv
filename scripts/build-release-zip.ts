import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { buildReleaseZip, inspectReleaseZip, RELEASE_ARCHIVE_NAME } from '../src/release-gate';

const args = process.argv.slice(2);
const hostIndex = args.indexOf('--desktop-host-root');
const hostInline = args.find((value) => value.startsWith('--desktop-host-root='));
const desktopHostRoot = hostInline
  ? hostInline.slice('--desktop-host-root='.length)
  : hostIndex >= 0 ? args[hostIndex + 1] : undefined;
if (!desktopHostRoot || desktopHostRoot.startsWith('--')) {
  throw new Error('release:zip requires an explicit --desktop-host-root <payload-directory>.');
}
const outputArgument = args.find((value, index) => !value.startsWith('--') && !(hostIndex >= 0 && index === hostIndex + 1));
// This is the public Windows Release command, so it remains strict even when
// a maintainer runs it from WSL or macOS. Library callers retain their
// platform-specific test seams through buildReleaseZip/inspectReleaseZip.
const requireDesktopHost = true;
const output = resolve(outputArgument ?? join(process.cwd(), 'dist', RELEASE_ARCHIVE_NAME));
await mkdir(dirname(output), { recursive: true });
const archive = await buildReleaseZip({ sourceRoot: process.cwd(), outputZip: output, desktopHostRoot, requireDesktopHost });
const inspection = await inspectReleaseZip({ zipPath: archive, requireDesktopHost });
if (!inspection.valid) throw new Error(`Release ZIP is incomplete: ${inspection.missing.join(', ')}`);
console.log(JSON.stringify({ ok: true, archive, entries: inspection.entries.length, required: inspection.requiredEntries }, null, 2));
