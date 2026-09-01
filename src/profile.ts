import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

import { environmentPath, pathDelimiter, resolveHarnessPaths, withEnvironmentPath, type HarnessPaths, type PathOptions } from './config';
import { resolveExecutable } from './executable';
import { commandFailure, runCommand, withoutCredentials, type CommandRunner } from './process';

export const PNPM_VERSION = '10.15.1';
export const PNPM_NPM_INTEGRITY = 'sha512-NOU4wym1VTAUyo6PRTWZf5YYCh0PYUM5NXRJk1NQ2STiL4YUaCGRJk7DPRRirCFWGv+X9rsYBlNRwWLH6PbeZw==';
export const PNPM_RUNTIME_RELATIVE = join('runtime', 'pnpm');
export const PNPM_MANIFEST_RELATIVE = join('runtime-manifests', 'pnpm');
const PNPM_PACKAGE = 'pnpm';

export interface ProfilePackageOptions extends PathOptions {
  dshExecutable?: string;
  pnpmExecutable?: string;
  pnpmRuntimeDir?: string;
  useAppOwnedPnpm?: boolean;
  /** Release-owned package.json/package-lock.json used for npm ci. */
  manifestRoot?: string;
  npmExecutable?: string;
  nodeExecutable?: string;
  commandRunner?: CommandRunner;
}

export interface PnpmRuntime {
  executable: string;
  env: Record<string, string | undefined>;
}

interface JsonObject {
  [key: string]: unknown;
}

async function readJson(path: string): Promise<JsonObject | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
  } catch {
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function profileDirFor(paths: HarnessPaths, profile: string): string {
  if (!profile || profile.includes('/') || profile.includes('\\') || profile === '.' || profile === '..') {
    throw new Error(`Invalid DSH profile name: ${JSON.stringify(profile)}`);
  }
  return join(paths.dshHome, 'profiles', profile);
}

export function pluginEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const safe = withoutCredentials(env);
  for (const key of ['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'GITHUB_TOKEN', 'GITLAB_TOKEN', 'npm_config__auth', 'npm_config_//registry.npmjs.org/:_authToken']) delete safe[key];
  return safe;
}

function prependPath(env: Record<string, string | undefined>, directory: string, platform: string): Record<string, string | undefined> {
  const current = environmentPath(env, platform);
  return withEnvironmentPath(env, [directory, current].filter(Boolean).join(pathDelimiter(platform)), platform);
}

async function findPnpmPackage(runtimeDir: string, platform: string): Promise<string | undefined> {
  const packageJson = await readJson(join(runtimeDir, 'node_modules', PNPM_PACKAGE, 'package.json'));
  if (packageJson?.version !== PNPM_VERSION) return undefined;
  const bin = packageJson.bin !== null && typeof packageJson.bin === 'object' && !Array.isArray(packageJson.bin)
    ? packageJson.bin as Record<string, unknown>
    : undefined;
  const entry = typeof packageJson.bin === 'string' ? packageJson.bin : bin?.pnpm;
  if (typeof entry !== 'string') return undefined;
  const candidate = resolve(runtimeDir, 'node_modules', PNPM_PACKAGE, entry);
  if (!(await exists(candidate))) return undefined;
  const shim = join(runtimeDir, 'node_modules', '.bin', platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  return (await exists(shim)) ? shim : candidate;
}

async function verifyPnpmRuntime(runtimeDir: string, platform: string): Promise<string | undefined> {
  const lock = await readJson(join(runtimeDir, 'package-lock.json'));
  const root = lock?.packages && typeof lock.packages === 'object' && !Array.isArray(lock.packages)
    ? (lock.packages as JsonObject)[''] as JsonObject | undefined
    : undefined;
  const locked = lock && (lock.packages as JsonObject | undefined)?.[`node_modules/${PNPM_PACKAGE}`] as JsonObject | undefined;
  const rootDependencies = root?.dependencies && typeof root.dependencies === 'object' && !Array.isArray(root.dependencies)
    ? root.dependencies as JsonObject
    : undefined;
  if (rootDependencies?.[PNPM_PACKAGE] !== PNPM_VERSION
    || !locked || locked.version !== PNPM_VERSION || locked.integrity !== PNPM_NPM_INTEGRITY) return undefined;
  const executable = await findPnpmPackage(runtimeDir, platform);
  if (!executable) return undefined;
  const packageRoot = resolve(runtimeDir, 'node_modules', PNPM_PACKAGE);
  try {
    const root = await realpath(runtimeDir);
    const target = await realpath(packageRoot);
    const escape = relative(root, target);
    if (escape === '..' || escape.startsWith(`..${sep}`)) return undefined;
  } catch {
    return undefined;
  }
  return executable;
}

export async function verifyPnpmRuntimeForDoctor(programRoot: string, platform: string = process.platform): Promise<{ valid: boolean; version?: string; executable?: string; error?: string }> {
  const runtimeDir = resolve(programRoot, PNPM_RUNTIME_RELATIVE);
  const executable = await verifyPnpmRuntime(runtimeDir, platform);
  if (!executable) return { valid: false, error: `App-owned pnpm ${PNPM_VERSION} is missing, has an invalid npm lock, or is outside the selected installation root.` };
  return { valid: true, version: PNPM_VERSION, executable };
}

export async function resolveDshInvocation(dsh: string, options: ProfilePackageOptions, env: Record<string, string | undefined>): Promise<{ command: string; prefix: string[] }> {
  const platform = options.platform ?? process.platform;
  if (!['.js', '.mjs', '.cjs'].includes(extname(dsh).toLowerCase())) return { command: dsh, prefix: [] };
  const runner = options.nodeExecutable ?? env.NODE_EXECUTABLE ?? await resolveExecutable('node', { platform, env });
  if (!runner) throw new Error(`DSH resolves to JavaScript entry ${dsh}, but Node.js could not be resolved to run it.`);
  return { command: runner, prefix: [dsh] };
}

export async function preparePnpmRuntime(options: ProfilePackageOptions, paths: HarnessPaths): Promise<PnpmRuntime> {
  const platform = options.platform ?? process.platform;
  const env = pluginEnvironment(options.env ?? process.env);
  const explicit = options.pnpmExecutable ?? (options.useAppOwnedPnpm ? undefined : env.PNPM_EXECUTABLE);
  const direct = explicit
    ? await resolveExecutable(explicit, { platform, env })
    : options.useAppOwnedPnpm
      ? undefined
      : await resolveExecutable('pnpm', { platform, env });
  if (direct) return { executable: direct, env: prependPath(env, dirname(direct), platform) };

  const runtimeDir = resolve(options.pnpmRuntimeDir ?? join(paths.programRoot, PNPM_RUNTIME_RELATIVE));
  let executable = await verifyPnpmRuntime(runtimeDir, platform);
  if (!executable) {
    const npm = options.npmExecutable ?? env.NPM_EXECUTABLE ?? await resolveExecutable('npm', { platform, env });
    if (!npm) throw new Error(`pnpm ${PNPM_VERSION} is not available and npm could not be resolved to install the app-owned plugin manager.`);
    const parent = dirname(runtimeDir);
    await mkdir(parent, { recursive: true });
    const staging = await mkdtemp(join(parent, `.${basename(runtimeDir)}.staging-`));
    let owned = true;
    try {
      const manifestRoot = resolve(options.manifestRoot ?? join(paths.programRoot, PNPM_MANIFEST_RELATIVE));
      for (const filename of ['package.json', 'package-lock.json']) {
        const source = join(manifestRoot, filename);
        if (!(await exists(source))) throw new Error(`Release-owned pnpm runtime ${filename} is missing at ${source}; refusing to resolve a target lock from the registry.`);
        await cp(source, join(staging, filename), { force: false, errorOnExist: true });
      }
      const runner = options.commandRunner ?? runCommand;
      const args = ['ci', '--legacy-peer-deps', '--no-audit', '--no-fund'];
      const result = await runner(npm, args, { cwd: staging, env, platform, timeoutMs: 15 * 60_000 });
      if (result.exitCode !== 0) throw new Error(commandFailure(npm, args, result, env).message);
      executable = await verifyPnpmRuntime(staging, platform);
      if (!executable) throw new Error(`app-owned pnpm ${PNPM_VERSION} failed verification after installation`);
      if (await exists(runtimeDir)) {
        const rollback = `${runtimeDir}.rollback-${Date.now()}`;
        await rename(runtimeDir, rollback);
        try {
          await rename(staging, runtimeDir);
          owned = false;
        } catch (error) {
          await rename(rollback, runtimeDir).catch(() => undefined);
          throw error;
        }
        await rm(rollback, { recursive: true, force: true });
      } else {
        await rename(staging, runtimeDir);
        owned = false;
      }
      executable = await verifyPnpmRuntime(runtimeDir, platform);
      if (!executable) throw new Error(`app-owned pnpm ${PNPM_VERSION} was not usable after its atomic install`);
    } finally {
      if (owned) await rm(staging, { recursive: true, force: true });
    }
  }
  return { executable, env: prependPath(env, dirname(executable), platform) };
}
