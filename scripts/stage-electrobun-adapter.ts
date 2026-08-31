import { cp, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { redactSensitive } from '../src/process';
import {
  ELECTROBUN_BUN_VERSION as PINNED_ELECTROBUN_BUN_VERSION,
  ELECTROBUN_HOST_COMMIT as PINNED_ELECTROBUN_HOST_COMMIT,
  ELECTROBUN_PRODUCT_IDENTIFIER,
  ELECTROBUN_PRODUCT_VERSION,
  ELECTROBUN_SIDECAR_RELATIVE,
  ELECTROBUN_SUPERVISOR_RELATIVE
} from '../src/desktop-host';

/**
 * The adapter consumes the reusable host as a pinned source tree. It generates
 * a disposable host workspace instead of copying host implementation into the
 * RPG Maker product repository.
 */
export const ELECTROBUN_HOST_COMMIT = PINNED_ELECTROBUN_HOST_COMMIT;
export const ELECTROBUN_BUN_VERSION = PINNED_ELECTROBUN_BUN_VERSION;
export const ELECTROBUN_SUPERVISOR = ELECTROBUN_SUPERVISOR_RELATIVE;
export const ELECTROBUN_SIDECAR = ELECTROBUN_SIDECAR_RELATIVE;
export const ELECTROBUN_OUTPUT_MARKER = '.dsh-electronbun-adapter-output';
const ELECTROBUN_OUTPUT_MARKER_CONTENT = 'dsh-electronbun-adapter-v1\n';

export const ELECTROBUN_PRODUCT_MANIFEST = {
  format: 1,
  owner: 'dsh-rpgmaker-mv',
  product: 'DSH-RPGMaker-MV',
  hostCommit: ELECTROBUN_HOST_COMMIT,
  // Electrobun's Windows runnable app is emitted as DSH.exe. The release
  // payload descriptor may override this when a maintainer renames the app.
  launchTarget: 'DSH.exe',
  app: {
    name: 'RPG Maker Agent',
    identifier: ELECTROBUN_PRODUCT_IDENTIFIER,
    version: ELECTROBUN_PRODUCT_VERSION
  },
  bun: {
    version: ELECTROBUN_BUN_VERSION,
    packageId: 'Oven-sh.Bun'
  },
  sidecar: {
    entrypoint: ELECTROBUN_SIDECAR,
    args: [] as string[]
  },
  readiness: {
    url: 'http://127.0.0.1:3081/',
    timeoutMs: 10 * 60 * 1000
  },
  navigation: {
    url: 'http://127.0.0.1:3081/'
  },
  window: {
    title: 'RPG Maker Agent',
    width: 1280,
    height: 900
  },
  supervisor: {
    executable: ELECTROBUN_SUPERVISOR
  }
} as const;

export interface StageElectrobunAdapterOptions {
  productRoot?: string;
  hostRoot: string;
  outputRoot?: string;
  force?: boolean;
}

export interface StageElectrobunAdapterResult {
  hostRoot: string;
  outputRoot: string;
  hostCommit: string;
  bunVersion: string;
  sidecar: string;
  supervisor: string;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const productRoot = resolve(import.meta.dir, '..');

function run(command: string, args: readonly string[], cwd?: string): CommandResult {
  const result = Bun.spawnSync([command, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe'
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr)
  };
}

function requireCommand(command: string, args: readonly string[], cwd: string, label: string): string {
  const result = run(command, args, cwd);
  if (result.exitCode !== 0) {
    const detail = redactSensitive(result.stderr.trim() || result.stdout.trim());
    throw new Error(`${label} failed (exit code ${result.exitCode})${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.trim();
}

function requireCleanHost(hostRoot: string): void {
  const status = requireCommand('git', ['status', '--porcelain', '--untracked-files=no'], hostRoot, 'host working tree check');
  if (status) {
    throw new Error(`The pinned host checkout has tracked changes; stage from a clean ${ELECTROBUN_HOST_COMMIT} checkout.`);
  }
}

function pathIsWithin(parent: string, child: string): boolean {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  const descendant = relative(parentPath, childPath);
  return descendant === '' || (!descendant.startsWith(`..${sep}`) && descendant !== '..' && !isAbsolute(descendant));
}

export function assertSeparateAdapterOutput(productRootPath: string, hostRoot: string, outputRoot: string): void {
  if (
    pathIsWithin(productRootPath, outputRoot) ||
    pathIsWithin(outputRoot, productRootPath) ||
    pathIsWithin(hostRoot, outputRoot) ||
    pathIsWithin(outputRoot, hostRoot)
  ) {
    throw new Error(`Adapter output must be separate from the product and host checkouts: ${resolve(outputRoot)}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function hasAdapterOutputMarker(outputRoot: string): Promise<boolean> {
  try {
    return await Bun.file(join(outputRoot, ELECTROBUN_OUTPUT_MARKER)).text() === ELECTROBUN_OUTPUT_MARKER_CONTENT;
  } catch {
    return false;
  }
}

export async function prepareAdapterOutput(outputRoot: string, force = false): Promise<void> {
  if (await pathExists(outputRoot)) {
    const existing = await readdir(outputRoot);
    if (existing.length > 0) {
      if (!force) {
        throw new Error(`Adapter output already exists and is not empty: ${outputRoot}. Pass --force only for this generated directory.`);
      }
      if (!(await hasAdapterOutputMarker(outputRoot))) {
        throw new Error(`Refusing to replace a non-empty directory not created by this adapter: ${outputRoot}.`);
      }
    }
    await rm(outputRoot, { recursive: true, force: true });
  }
  await mkdir(outputRoot, { recursive: true });
  await Bun.write(join(outputRoot, ELECTROBUN_OUTPUT_MARKER), ELECTROBUN_OUTPUT_MARKER_CONTENT);
}

async function copyTrackedHost(hostRoot: string, outputRoot: string): Promise<void> {
  const listing = requireCommand('git', ['ls-files', '-z'], hostRoot, 'host file listing');
  for (const relativePath of listing.split('\0').filter(Boolean)) {
    const source = join(hostRoot, relativePath);
    const target = join(outputRoot, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, force: true });
  }
}

async function buildSidecar(productRootPath: string, outputRoot: string): Promise<string> {
  const entrypoint = join(productRootPath, 'src', 'electrobun-sidecar.ts');
  const output = join(outputRoot, ELECTROBUN_SIDECAR);
  await mkdir(dirname(output), { recursive: true });
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: dirname(output),
    naming: 'dsh-rpgmaker-sidecar.js',
    target: 'bun',
    minify: false,
    sourcemap: 'none'
  });
  if (!result.success) {
    const diagnostics = result.logs.map((log) => log.message).join('\n');
    throw new Error(`RPG Maker Electrobun sidecar build failed${diagnostics ? `:\n${diagnostics}` : '.'}`);
  }
  return output;
}

function productManifestText(): string {
  return [
    'import type { ProductManifest } from "./src/host/manifest";',
    '',
    `export const referenceManifest = ${JSON.stringify(ELECTROBUN_PRODUCT_MANIFEST, null, 2)} satisfies ProductManifest;`,
    '',
    'export default referenceManifest;',
    ''
  ].join('\n');
}

async function writeProductConfiguration(outputRoot: string): Promise<void> {
  await writeFileCompat(join(outputRoot, 'product.manifest.ts'), productManifestText());
}

async function writeFileCompat(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
}

async function copySupervisor(hostRoot: string, outputRoot: string): Promise<string> {
  const source = join(hostRoot, 'supervisor', ELECTROBUN_SUPERVISOR);
  const target = join(outputRoot, 'supervisor', ELECTROBUN_SUPERVISOR);
  if (!(await pathExists(source))) {
    throw new Error(`The pinned host supervisor is missing at ${source}; run its Windows x64 supervisor build first.`);
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { force: true });
  return target;
}

export async function stageElectrobunAdapter(
  options: StageElectrobunAdapterOptions,
): Promise<StageElectrobunAdapterResult> {
  const productRootPath = resolve(options.productRoot ?? productRoot);
  const hostRoot = resolve(options.hostRoot);
  const outputRoot = resolve(options.outputRoot ?? await mkdtemp(join(tmpdir(), 'dsh-rpgmaker-electrobun-')));
  const hostCommit = requireCommand('git', ['rev-parse', 'HEAD'], hostRoot, 'host revision lookup');
  if (hostCommit !== ELECTROBUN_HOST_COMMIT) {
    throw new Error(`The adapter requires dsh-electronbun ${ELECTROBUN_HOST_COMMIT}; found ${hostCommit}.`);
  }
  requireCleanHost(hostRoot);
  assertSeparateAdapterOutput(productRootPath, hostRoot, outputRoot);
  await prepareAdapterOutput(outputRoot, options.force);

  await copyTrackedHost(hostRoot, outputRoot);
  await writeProductConfiguration(outputRoot);
  const sidecar = await buildSidecar(productRootPath, outputRoot);
  const supervisor = await copySupervisor(hostRoot, outputRoot);
  return {
    hostRoot,
    outputRoot,
    hostCommit,
    bunVersion: ELECTROBUN_BUN_VERSION,
    sidecar,
    supervisor
  };
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseCli(args: string[]): StageElectrobunAdapterOptions {
  const hostRoot = valueAfter(args, '--host-root');
  if (!hostRoot) throw new Error('usage: bun run desktop:stage -- --host-root <dsh-electronbun> [--output-root <dir>] [--force]');
  const outputRoot = valueAfter(args, '--output-root');
  return { hostRoot, outputRoot, force: args.includes('--force') };
}

if (import.meta.main) {
  stageElectrobunAdapter(parseCli(process.argv.slice(2)))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
