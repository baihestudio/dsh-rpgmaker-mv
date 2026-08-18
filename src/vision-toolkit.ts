import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

import { findDshExecutable } from './bootstrap';
import { resolveHarnessPaths, pathDelimiter, type HarnessPaths, type PathOptions } from './config';
import { resolveExecutable } from './executable';
import { commandFailure, prepareProcessInvocation, redactSensitive, runCommand, terminateProcessTree, withoutCredentials, type CommandRunner } from './process';

export const VISION_TOOLKIT_PACKAGE = '@anionex/dsh-vision-toolkit';
export const VISION_TOOLKIT_VERSION = '0.1.31';
export const VISION_TOOLKIT_NPM_INTEGRITY = 'sha512-0fp+8mBKXxn/nrYj+Gbq3a6CmmwS0HOIOrPwLKh0nYOB+Yst71M9BCTusjb+TerHSbTtqEHutBwqx91+ovXk8w==';
export const VISION_TOOLKIT_LICENSE = 'MIT';
export const VISION_TOOLKIT_BUNDLE_PATCH = './cordis.patch.yml';
export const VISION_TOOLKIT_PROFILE = 'web';
export const VISION_TOOLKIT_BASE_URL = 'https://vision.anionex.me/v1';
export const VISION_TOOLKIT_MODEL = 'gemini-3.7-flash';
export const VISION_TOOLKIT_CREDENTIAL = 'ANIONEX_FREE_VISION';
export const VISION_TOOLKIT_DAILY_LIMIT = 300;
export const VISION_TOOLKIT_IMAGES_PER_REQUEST = 5;
export const VISION_TOOLKIT_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const VISION_TOOLKIT_MAX_IMAGE_PIXELS = 20_000_000;
export const VISION_TOOLKIT_MAX_OUTPUT_TOKENS = 4_096;

export const VISION_TOOL_NAMES = [
  'vision_glance',
  'vision_ground',
  'vision_detect',
  'vision_crop',
  'vision_trace',
  'vision_pixel_diff',
  'vision_long_screenshot_ocr',
  'vision_extract_foreground',
  'vision_dominant_colors',
  'vision_html_screenshot'
] as const;

const PNPM_PACKAGE = 'pnpm';
const PNPM_VERSION = '10.15.1';
const PNPM_RUNTIME_RELATIVE = join('runtime', 'pnpm');

export interface VisionToolkitOptions extends PathOptions {
  dshExecutable?: string;
  pnpmExecutable?: string;
  pnpmRuntimeDir?: string;
  npmExecutable?: string;
  commandRunner?: CommandRunner;
  profile?: string;
  prepareRuntime?: boolean;
  runtimeWarmupTimeoutMs?: number;
}

export interface VisionToolkitVerification {
  valid: boolean;
  errors: string[];
  profile: string;
  profileDir: string;
  manifestPath: string;
  packageDir?: string;
  packageVersion?: string;
  profileDependency?: string;
  bundleOccurrences: number;
  runtimeCacheDir: string;
  managedRuntimeReady: boolean;
  provider: {
    baseUrl: string;
    model: string;
    credential: string;
    dailyLimit: number;
    imagesPerRequest: number;
    maxImageBytes: number;
    maxImagePixels: number;
    maxOutputTokens: number;
  };
}

interface JsonObject {
  [key: string]: unknown;
}

interface PnpmRuntime {
  executable: string;
  env: Record<string, string | undefined>;
}

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

async function readJson(path: string): Promise<JsonObject | undefined> {
  try {
    return asObject(JSON.parse(await readFile(path, 'utf8')));
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

function profileDirFor(paths: HarnessPaths, profile: string): string {
  if (!profile || profile.includes('/') || profile.includes('\\') || profile === '.' || profile === '..') {
    throw new Error(`Invalid DSH profile name: ${JSON.stringify(profile)}`);
  }
  return join(paths.dshHome, 'profiles', profile);
}

function pluginEnvironment(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const safe = withoutCredentials(env);
  for (const key of ['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'GITHUB_TOKEN', 'GITLAB_TOKEN', 'npm_config__auth', 'npm_config_//registry.npmjs.org/:_authToken']) delete safe[key];
  return safe;
}

function prependPath(env: Record<string, string | undefined>, directory: string, platform: string): Record<string, string | undefined> {
  const current = env.PATH ?? '';
  return { ...env, PATH: [directory, current].filter(Boolean).join(pathDelimiter(platform)) };
}

function profilePackageDir(profileDir: string): string {
  return join(profileDir, 'node_modules', '@anionex', 'dsh-vision-toolkit');
}

function runtimeCacheDir(paths: HarnessPaths): string {
  return join(paths.dshHome, 'cache', 'dsh-vision-toolkit');
}

async function managedRuntimeReady(cacheDir: string, platform: string = process.platform): Promise<boolean> {
  const pythonRoot = join(cacheDir, 'python');
  let entries;
  try {
    entries = await readdir(pythonRoot, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runtimeRoot = join(pythonRoot, entry.name);
    const marker = await readJson(join(runtimeRoot, 'runtime.json'));
    if (marker?.schemaVersion !== 1 || typeof marker.upstreamCommit !== 'string' || typeof marker.upstreamContentSha256 !== 'string' || typeof marker.requirementsSha256 !== 'string' || typeof marker.pythonVersion !== 'string') continue;
    const interpreter = platform === 'win32' ? join(runtimeRoot, 'Scripts', 'python.exe') : join(runtimeRoot, 'bin', 'python');
    if (await exists(interpreter)) return true;
  }
  return false;
}

function baseProvider() {
  return {
    baseUrl: VISION_TOOLKIT_BASE_URL,
    model: VISION_TOOLKIT_MODEL,
    credential: VISION_TOOLKIT_CREDENTIAL,
    dailyLimit: VISION_TOOLKIT_DAILY_LIMIT,
    imagesPerRequest: VISION_TOOLKIT_IMAGES_PER_REQUEST,
    maxImageBytes: VISION_TOOLKIT_MAX_IMAGE_BYTES,
    maxImagePixels: VISION_TOOLKIT_MAX_IMAGE_PIXELS,
    maxOutputTokens: VISION_TOOLKIT_MAX_OUTPUT_TOKENS
  };
}

async function findPnpmPackage(runtimeDir: string, platform: string): Promise<string | undefined> {
  const packageJson = await readJson(join(runtimeDir, 'node_modules', PNPM_PACKAGE, 'package.json'));
  if (packageJson?.version !== PNPM_VERSION) return undefined;
  const bin = asObject(packageJson.bin);
  const entry = typeof packageJson.bin === 'string' ? packageJson.bin : bin?.pnpm;
  if (typeof entry !== 'string') return undefined;
  const candidate = resolve(runtimeDir, 'node_modules', PNPM_PACKAGE, entry);
  if (!(await exists(candidate))) return undefined;
  const shim = join(runtimeDir, 'node_modules', '.bin', platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  return (await exists(shim)) ? shim : candidate;
}

async function verifyPnpmRuntime(runtimeDir: string, platform: string): Promise<string | undefined> {
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

async function resolveDshInvocation(dsh: string, options: VisionToolkitOptions, env: Record<string, string | undefined>): Promise<{ command: string; prefix: string[] }> {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32' || !['.js', '.mjs', '.cjs'].includes(extname(dsh).toLowerCase())) return { command: dsh, prefix: [] };
  const runner = options.env?.NODE_EXECUTABLE ?? env.NODE_EXECUTABLE ?? await resolveExecutable('node', { platform, env })
    ?? options.env?.BUN_EXECUTABLE ?? env.BUN_EXECUTABLE ?? await resolveExecutable('bun', { platform, env });
  if (!runner) throw new Error(`DSH resolves to JavaScript entry ${dsh}, but neither Bun nor Node could be resolved to run it.`);
  return { command: runner, prefix: [dsh] };
}

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolvePromise());
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : undefined;
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
  if (!port) throw new Error('Could not allocate a loopback port for Vision Toolkit runtime preparation.');
  return port;
}

async function warmVisionToolkitRuntime(options: VisionToolkitOptions, paths: HarnessPaths): Promise<void> {
  const platform = options.platform ?? process.platform;
  const env = pluginEnvironment(options.env ?? process.env);
  const dsh = options.dshExecutable ?? env.DSH_EXECUTABLE ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!dsh) throw new Error('Pinned DSH executable was not found; cannot prepare the Vision Toolkit managed runtime.');
  const invocation = await resolveDshInvocation(dsh, options, env);
  const port = await freeLoopbackPort();
  const args = [...invocation.prefix, '--profile', options.profile ?? VISION_TOOLKIT_PROFILE, '--host', '127.0.0.1', '--port', String(port)];
  const processEnv = Object.fromEntries(Object.entries({ ...env, DSH_HOME: paths.dshHome }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const invocationResult = prepareProcessInvocation(invocation.command, args, platform, processEnv);
  let child: ChildProcess;
  try {
    child = spawn(invocationResult.command, invocationResult.args, {
      cwd: paths.dshHome,
      env: processEnv,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: platform === 'win32' && /\\.(?:cmd|bat)$/i.test(dsh),
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    throw new Error(`Vision Toolkit runtime preparation could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
  let output = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { output += chunk; });
  child.stderr?.on('data', (chunk: string) => { output += chunk; });
  const timeoutMs = options.runtimeWarmupTimeoutMs ?? 15 * 60_000;
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (await managedRuntimeReady(runtimeCacheDir(paths), platform)) return;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Vision Toolkit Web boot exited before its managed runtime was ready (code ${child.exitCode ?? 'signal'}).${output.trim() ? ` ${output.trim().slice(-2000)}` : ''}`);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    throw new Error(`Vision Toolkit managed runtime preparation timed out after ${timeoutMs} ms.${output.trim() ? ` ${output.trim().slice(-2000)}` : ''}`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      await terminateProcessTree(child, { cwd: paths.dshHome, env: processEnv, platform }).catch((error) => {
        throw new Error(`Vision Toolkit runtime process could not be terminated cleanly: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }
}

async function preparePnpmRuntime(options: VisionToolkitOptions, paths: HarnessPaths): Promise<PnpmRuntime> {
  const platform = options.platform ?? process.platform;
  const env = pluginEnvironment(options.env ?? process.env);
  const explicit = options.pnpmExecutable ?? env.PNPM_EXECUTABLE;
  const direct = explicit ? await resolveExecutable(explicit, { platform, env }) : await resolveExecutable('pnpm', { platform, env });
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
      await writeFile(join(staging, 'package.json'), `${JSON.stringify({ name: 'dsh-rpgmaker-pnpm-runtime', private: true }, null, 2)}\n`);
      const runner = options.commandRunner ?? runCommand;
      const args = ['install', '--prefix', staging, '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', '--save-exact', `${PNPM_PACKAGE}@${PNPM_VERSION}`];
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

/** Verify the installed DSH profile layer without booting or calling the remote provider. */
export async function verifyVisionToolkit(options: VisionToolkitOptions = {}): Promise<VisionToolkitVerification> {
  const paths = resolveHarnessPaths(options);
  const profile = options.profile ?? VISION_TOOLKIT_PROFILE;
  const profileDir = profileDirFor(paths, profile);
  const manifestPath = join(profileDir, 'package.json');
  const packageDir = profilePackageDir(profileDir);
  const manifest = await readJson(manifestPath);
  const errors: string[] = [];
  const dependencies = asObject(manifest?.dependencies);
  const dependency = dependencies?.[VISION_TOOLKIT_PACKAGE];
  if (dependency !== VISION_TOOLKIT_VERSION) errors.push(`profile dependency ${VISION_TOOLKIT_PACKAGE}@${VISION_TOOLKIT_VERSION} is not exact-pinned`);
  const profileConfig = asObject(asObject(manifest?.dsh)?.profile);
  const layers = Array.isArray(profileConfig?.bundles) ? profileConfig.bundles : [];
  const bundleOccurrences = layers.filter((value) => value === VISION_TOOLKIT_PACKAGE).length;
  if (bundleOccurrences !== 1) errors.push(`profile contains ${bundleOccurrences} ${VISION_TOOLKIT_PACKAGE} bundle layers; expected exactly one`);
  const packageManifest = await readJson(join(packageDir, 'package.json'));
  const packageVersion = typeof packageManifest?.version === 'string' ? packageManifest.version : undefined;
  if (packageVersion !== VISION_TOOLKIT_VERSION) errors.push(`installed Vision Toolkit version is ${packageVersion ?? 'missing'}, expected ${VISION_TOOLKIT_VERSION}`);
  if (packageManifest?.license !== VISION_TOOLKIT_LICENSE) errors.push(`Vision Toolkit license is ${String(packageManifest?.license ?? 'missing')}, expected ${VISION_TOOLKIT_LICENSE}`);
  const bundle = asObject(packageManifest?.dsh)?.bundle;
  if (asObject(bundle)?.patch !== VISION_TOOLKIT_BUNDLE_PATCH) errors.push(`Vision Toolkit dsh.bundle.patch is not ${VISION_TOOLKIT_BUNDLE_PATCH}`);
  const lockPath = join(profileDir, 'pnpm-lock.yaml');
  const lock = await readFile(lockPath, 'utf8').catch(() => '');
  if (!lock.includes(`${VISION_TOOLKIT_PACKAGE}@${VISION_TOOLKIT_VERSION}`) || !lock.includes(VISION_TOOLKIT_NPM_INTEGRITY)) {
    errors.push('profile pnpm lockfile does not contain the pinned Vision Toolkit package and registry integrity');
  }
  const cacheDir = runtimeCacheDir(paths);
  return {
    valid: errors.length === 0,
    errors,
    profile,
    profileDir,
    manifestPath,
    ...(packageVersion === VISION_TOOLKIT_VERSION ? { packageDir } : {}),
    ...(packageVersion ? { packageVersion } : {}),
    ...(typeof dependency === 'string' ? { profileDependency: dependency } : {}),
    bundleOccurrences,
    runtimeCacheDir: cacheDir,
    managedRuntimeReady: await managedRuntimeReady(cacheDir, options.platform ?? process.platform),
    provider: baseProvider()
  };
}

/** Install the exact Vision Toolkit bundle through DSH's supported plugin command. */
export async function prepareVisionToolkit(options: VisionToolkitOptions = {}): Promise<VisionToolkitVerification> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const env = pluginEnvironment(options.env ?? process.env);
  await mkdir(paths.dshHome, { recursive: true });
  const current = await verifyVisionToolkit(options);
  if (current.valid) {
    if (!current.managedRuntimeReady && options.prepareRuntime !== false) {
      await warmVisionToolkitRuntime(options, paths);
      return verifyVisionToolkit(options);
    }
    return current;
  }
  const pnpm = await preparePnpmRuntime(options, paths);
  const dsh = options.dshExecutable ?? env.DSH_EXECUTABLE ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!dsh) throw new Error('Pinned DSH executable was not found; cannot install Vision Toolkit through the standard DSH plugin manager.');
  const runner = options.commandRunner ?? runCommand;
  const profile = options.profile ?? VISION_TOOLKIT_PROFILE;
  const args = ['plugin', '--profile', profile, 'add', '--save-exact', '--ignore-scripts', `${VISION_TOOLKIT_PACKAGE}@${VISION_TOOLKIT_VERSION}`];
  const invocation = await resolveDshInvocation(dsh, options, env);
  const commandArgs = [...invocation.prefix, ...args];
  let result;
  try {
    result = await runner(invocation.command, commandArgs, {
      cwd: paths.dshHome,
      env: pnpm.env,
      platform,
      timeoutMs: 15 * 60_000
    });
  } catch (error) {
    throw new Error(redactSensitive(`Vision Toolkit plugin manager could not start: ${error instanceof Error ? error.message : String(error)}`, env));
  }
  if (result.exitCode !== 0) throw new Error(redactSensitive(commandFailure(invocation.command, commandArgs, result, env).message, env));
  const installed = await verifyVisionToolkit(options);
  if (!installed.valid) throw new Error(`Vision Toolkit installation completed but verification failed: ${installed.errors.join('; ')}`);
  if (!installed.managedRuntimeReady && options.prepareRuntime !== false) {
    await warmVisionToolkitRuntime(options, paths);
    return verifyVisionToolkit(options);
  }
  return installed;
}

export function visionToolkitDisclosure(): string {
  return `视觉理解默认使用共享远程服务 ${VISION_TOOLKIT_BASE_URL}（模型 ${VISION_TOOLKIT_MODEL}）。图片会发送到该服务；每台机器每天最多 ${VISION_TOOLKIT_DAILY_LIMIT} 张，每次最多 ${VISION_TOOLKIT_IMAGES_PER_REQUEST} 张，单图上限 ${VISION_TOOLKIT_MAX_IMAGE_BYTES / (1024 * 1024)} MiB 和 ${VISION_TOOLKIT_MAX_IMAGE_PIXELS.toLocaleString('en-US')} 像素，输出最多 ${VISION_TOOLKIT_MAX_OUTPUT_TOKENS.toLocaleString('en-US')} tokens。需要私有接口或更高配额时，请在设置 → Vision Toolkit 配置自己的接口和 DSH Credential。`;
}

export function visionToolkitCachePath(paths: HarnessPaths): string {
  return runtimeCacheDir(paths);
}

export { PNPM_VERSION, PNPM_RUNTIME_RELATIVE };
