import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { resolveHarnessPaths, type PathOptions } from './config';
import { isRegularFile } from './files';
import { resolveExecutable } from './executable';
import { commandFailure, runCommand, withoutCredentials, type CommandRunner } from './process';
import { pinnedImageRelease, pinnedOxipngRelease, type ImageReleasePin } from './image-releases';

export const IMAGE_MAGICK_VERSION = '7.1.2-29';
export const FREE_TEX_PACKER_VERSION = '0.3.9';
export const OXIPNG_VERSION = '10.2.0';
export const ASSET_WORKSHOP_PRESET_ID = 'asset-workshop';
export const IMAGE_WORKSHOP_MANIFEST_FORMAT = 2;

const FREE_TEX_PACKAGE = 'free-tex-packer-core';
const FREE_TEX_LOCK_INTEGRITY = 'sha512-Ah4FuRZc57oVLOtkyUjGB9YAjF0ot3T6ccvXw/lvhkndneHwbfkrNT8yz9E7kFak26DPsWJhXS6JjYEsCJkiFA==';
const DEFAULT_TOOLCHAIN_RELATIVE = join('tools', 'image-workshop');
const IMAGE_MANIFEST_NAME = 'toolchain.json';
const NATIVE_TOOLS_DIRECTORY = 'native-tools';
const IMAGE_MAGICK_INSTALL_DIRECTORY = 'image-magick';
const OXIPNG_INSTALL_DIRECTORY = 'oxipng';

export interface OptionalEnhancements {
  aseprite?: string;
  texturePacker?: string;
  photoshop?: string;
}

export interface NativeToolManifest {
  path: string;
  version: string;
  url: string;
  archiveSha256: string;
  archiveMember: string;
  sha256: string;
}

export interface ImageToolchainManifest {
  format: number;
  imageMagick: NativeToolManifest;
  helper: {
    root: string;
    lockPath: string;
    lockSha256: string;
    packageVersion: string;
    integrity: string;
  };
  optionalEnhancements?: OptionalEnhancements;
  oxipng?: NativeToolManifest;
}

export interface ImageToolchain {
  toolchainRoot: string;
  manifestPath: string;
  imageMagick: string;
  imageMagickVersion: string;
  imageMagickSha256?: string;
  imageMagickUrl?: string;
  imageMagickArchiveSha256?: string;
  imageMagickArchiveMember?: string;
  helperRoot: string;
  helperPackagePath: string;
  helperPackageVersion: string;
  helperLockPath?: string;
  helperLockSha256?: string;
  helperIntegrity?: string;
  oxipng?: string;
  oxipngVersion?: string;
  oxipngSha256?: string;
  oxipngUrl?: string;
  oxipngArchiveSha256?: string;
  oxipngArchiveMember?: string;
  optionalEnhancements: OptionalEnhancements;
}

export interface ImageArchiveOperationOptions {
  platform: string;
  env: Record<string, string | undefined>;
  executableName: string;
  version: string;
  kind: 'ImageMagick' | 'oxipng';
}

export type ImageArchiveDownloader = (url: string, destination: string, options: ImageArchiveOperationOptions) => Promise<void>;
export type ImageArchiveExtractor = (archive: string, destination: string, options: ImageArchiveOperationOptions) => Promise<void>;
export type ImageToolRenamePath = (from: string, to: string) => Promise<void>;

export interface ImageToolchainOptions extends PathOptions {
  toolchainRoot?: string;
  manifestPath?: string;
  imageMagickExecutable?: string;
  imageMagickSha256?: string;
  imageMagickUrl?: string;
  helperRoot?: string;
  oxipngExecutable?: string;
  oxipngSha256?: string;
  oxipngUrl?: string;
  installOxipng?: boolean;
  /** Test-owned release seam; production uses the checked-in release pins. */
  imageMagickRelease?: ImageReleasePin;
  /** Test-owned release seam; production uses the checked-in release pins. */
  oxipngRelease?: ImageReleasePin;
  downloadArchive?: ImageArchiveDownloader;
  extractArchive?: ImageArchiveExtractor;
  archiveExtractorExecutable?: string;
  /** Verified 7-Zip executable used to extract .7z archives on Windows. */
  sevenZipExecutable?: string;
  renamePath?: ImageToolRenamePath;
  commandRunner?: CommandRunner;
}

export interface ImageHelperRuntimeOptions extends ImageToolchainOptions {
  helperRuntimeDir?: string;
  bunExecutable?: string;
  now?: () => Date;
}

export interface ImageToolchainPreparationOptions extends ImageToolchainOptions {
  helperRuntimeDir?: string;
  bunExecutable?: string;
  now?: () => Date;
}

export interface ImageToolchainPreparation {
  toolchain: ImageToolchain;
  helperRuntimeDir: string;
}

export class ImageWorkshopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageWorkshopError';
  }
}

type JsonObject = Record<string, unknown>;

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

function imageToolchainRoot(options: ImageToolchainOptions): string {
  const paths = resolveHarnessPaths(options);
  const env = options.env ?? process.env;
  return resolve(options.toolchainRoot ?? env.DSH_IMAGE_WORKSHOP_ROOT ?? join(paths.programRoot, DEFAULT_TOOLCHAIN_RELATIVE));
}

function manifestPathFor(options: ImageToolchainOptions, root: string): string {
  const env = options.env ?? process.env;
  return resolve(options.manifestPath ?? env.DSH_IMAGE_WORKSHOP_MANIFEST ?? join(root, IMAGE_MANIFEST_NAME));
}

function absoluteConfiguredPath(value: unknown, label: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const result = resolve(value);
  if (result !== value && !value.startsWith('\\\\') && !/^[A-Za-z]:[\\/]/.test(value) && !value.startsWith('/')) {
    throw new ImageWorkshopError(`${label} must be an absolute path; PATH lookup is not allowed for pinned image tools.`);
  }
  return result;
}

function requireVersion(value: unknown, expected: string, label: string): void {
  if (value !== expected) throw new ImageWorkshopError(`${label} is ${String(value ?? 'missing')}; expected pinned ${expected}.`);
}

function parseImageMagickVersion(output: string): string | undefined {
  return output.match(/ImageMagick\s+(\d+\.\d+\.\d+-\d+)/i)?.[1];
}

function parseOxipngVersion(output: string): string | undefined {
  return output.match(/oxipng\s+v?(\d+\.\d+\.\d+)/i)?.[1] ?? output.match(/\bv?(\d+\.\d+\.\d+)\b/)?.[1];
}

function normalizeSha256(value: string): string {
  return value.trim().toLowerCase();
}

function requireSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value.trim())) {
    throw new ImageWorkshopError(`${label} must contain a 64-character SHA-256 checksum; refusing an unverified native tool.`);
  }
  return normalizeSha256(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new ImageWorkshopError(`${label} is missing from the pinned manifest.`);
  return value;
}

function requirePinnedIntegrity(value: unknown): string {
  if (value !== FREE_TEX_LOCK_INTEGRITY) throw new ImageWorkshopError('Image helper npm integrity is not the pinned package integrity.');
  return FREE_TEX_LOCK_INTEGRITY;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

function validateUrl(value: unknown, version: string, label: string): string {
  if (typeof value !== 'string' || !value.startsWith('https://') || !value.includes(version)) {
    throw new ImageWorkshopError(`${label} must be an exact HTTPS release URL containing ${version}.`);
  }
  return value;
}

function isWithin(parent: string, child: string): boolean {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  const path = relative(parentPath, childPath);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..');
}

async function commandVersion(
  runner: CommandRunner,
  command: string,
  args: string[],
  options: ImageToolchainOptions,
  label: string
): Promise<string> {
  let result;
  try {
    result = await runner(command, args, {
      env: withoutCredentials(options.env ?? process.env),
      platform: options.platform ?? process.platform,
      timeoutMs: 30_000
    });
  } catch (error) {
    throw new ImageWorkshopError(`${label} could not start at ${command}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result.exitCode !== 0) throw new ImageWorkshopError(commandFailure(command, args, result, options.env ?? process.env).message);
  return `${result.stdout}\n${result.stderr}`;
}

async function verifyPinnedFile(path: string, label: string, expectedHash: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (!info?.isFile() || info.isSymbolicLink() || !(await isRegularFile(path))) throw new ImageWorkshopError(`${label} was not found as a regular app-owned file at resolved path ${path}. Install or repair the app-owned image toolchain.`);
  const actual = await sha256File(path);
  if (normalizeSha256(actual) !== normalizeSha256(expectedHash)) {
    throw new ImageWorkshopError(`${label} checksum does not match the pinned manifest at ${path}.`);
  }
}

async function assertNoSymlinkPath(root: string, path: string, label: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (!isWithin(resolvedRoot, resolvedPath)) throw new ImageWorkshopError(`${label} escaped the harness-owned staging directory: ${resolvedPath}.`);
  const parts = relative(resolvedRoot, resolvedPath).split(sep).filter(Boolean);
  let current = resolvedRoot;
  for (const part of parts) {
    current = join(current, part);
    const info = await lstat(current).catch(() => undefined);
    if (info?.isSymbolicLink()) throw new ImageWorkshopError(`${label} contains a symbolic link or junction: ${current}.`);
  }
}

async function optionalLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function samePathIdentity(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

async function defaultDownloadArchive(url: string, destination: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new ImageWorkshopError(`Pinned image tool download could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new ImageWorkshopError(`Pinned image tool download failed with HTTP ${response.status}.`);
  try {
    await writeFile(destination, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
  } catch (error) {
    throw new ImageWorkshopError(`Pinned image tool archive could not be staged: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function defaultExtractArchive(
  archive: string,
  destination: string,
  operation: ImageArchiveOperationOptions,
  options: ImageToolchainOptions
): Promise<void> {
  const runner = options.commandRunner ?? runCommand;
  const env = withoutCredentials(operation.env);
  // The pinned ImageMagick portable build ships only as a .7z, which Windows
  // tar cannot decode ("LZMA codec is unsupported"). Route .7z archives to a
  // verified 7-Zip executable with 7z-style args; keep tar for .zip and other
  // archives. Argument syntax follows the archive type so an explicit override
  // either fits the actual extractor or fails clearly with its own message.
  const archiveIsSevenZip = /\.7z$/i.test(archive);
  const extractor = archiveIsSevenZip
    ? options.sevenZipExecutable ?? operation.env.SEVEN_ZIP_EXECUTABLE ?? options.archiveExtractorExecutable ?? '7z'
    : options.archiveExtractorExecutable ?? operation.env.DSH_ARCHIVE_EXTRACTOR ?? 'tar';
  const args = archiveIsSevenZip
    ? ['x', archive, `-o${destination}`, '-y']
    : ['-xf', archive, '-C', destination];
  let result;
  try {
    result = await runner(extractor, args, {
      cwd: destination,
      env,
      platform: operation.platform,
      timeoutMs: 15 * 60_000
    });
  } catch (error) {
    throw new ImageWorkshopError(`${operation.kind} archive extraction could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result.exitCode !== 0) throw new ImageWorkshopError(`${operation.kind} archive extraction failed: ${commandFailure(extractor, args, result, operation.env).message}`);
}

async function findExtractedExecutable(root: string, executableName: string, label: string): Promise<string> {
  const matches: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = join(directory, entry.name);
      const info = await lstat(candidate);
      if (info.isSymbolicLink()) throw new ImageWorkshopError(`${label} archive contained a symbolic link: ${candidate}.`);
      if (info.isDirectory()) {
        await walk(candidate);
      } else if (info.isFile() && entry.name.toLowerCase() === executableName.toLowerCase()) {
        matches.push(candidate);
      }
    }
  };
  await walk(root);
  if (matches.length !== 1) throw new ImageWorkshopError(`${label} archive must contain exactly one ${executableName}; found ${matches.length}.`);
  return matches[0];
}

function nativeInstallDirectory(toolchainRoot: string, kind: 'imageMagick' | 'oxipng'): string {
  return join(toolchainRoot, NATIVE_TOOLS_DIRECTORY, kind === 'imageMagick' ? IMAGE_MAGICK_INSTALL_DIRECTORY : OXIPNG_INSTALL_DIRECTORY);
}

function releaseFor(options: ImageToolchainOptions, platform: string, kind: 'imageMagick' | 'oxipng'): ImageReleasePin | undefined {
  if (kind === 'imageMagick' && options.imageMagickRelease) return options.imageMagickRelease;
  if (kind === 'oxipng' && options.oxipngRelease) return options.oxipngRelease;
  return kind === 'imageMagick'
    ? pinnedImageRelease(platform) ?? (platform === 'win32' ? pinnedImageRelease(platform, 'x64') : undefined)
    : pinnedOxipngRelease(platform) ?? (platform === 'win32' ? pinnedOxipngRelease(platform, 'x64') : undefined);
}

async function validInstalledNativeExecutable(
  root: string,
  executable: string,
  expectedVersion: string,
  expectedHash: string,
  options: ImageToolchainOptions,
  label: string
): Promise<boolean> {
  try {
    await assertNoSymlinkPath(root, executable, label);
    await verifyPinnedFile(executable, label, expectedHash);
    const output = await commandVersion(options.commandRunner ?? runCommand, executable, ['--version'], options, label);
    requireVersion(label === 'oxipng' ? parseOxipngVersion(output) : parseImageMagickVersion(output), expectedVersion, label);
    return true;
  } catch {
    return false;
  }
}

async function installPinnedNativeTool(
  options: ImageToolchainOptions,
  toolchainRoot: string,
  kind: 'imageMagick' | 'oxipng',
  release: ImageReleasePin
): Promise<string> {
  const expectedVersion = kind === 'imageMagick' ? IMAGE_MAGICK_VERSION : OXIPNG_VERSION;
  const label = kind === 'imageMagick' ? 'ImageMagick' : 'oxipng';
  const activeRoot = nativeInstallDirectory(toolchainRoot, kind);
  const parent = dirname(activeRoot);
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const runner = options.commandRunner ?? runCommand;
  const renameForInstall = options.renamePath ?? rename;
  const expectedExecutableHash = requireSha256(release.executableSha256, `${label} executable SHA-256`);
  const expectedArchiveHash = requireSha256(release.archiveSha256, `${label} archive SHA-256`);
  const executableName = requireString(release.executableName, `${label} archived executable member`);
  validateUrl(release.url, expectedVersion, `${label} URL`);

  await mkdir(parent, { recursive: true });
  const existingRoot = await optionalLstat(activeRoot);
  if (existingRoot?.isSymbolicLink()) throw new ImageWorkshopError(`${label} install directory is a symbolic link or junction; refusing to replace it: ${activeRoot}.`);
  let existingCandidate = join(activeRoot, executableName);
  if (existingRoot?.isDirectory()) {
    if (!(await optionalLstat(existingCandidate))?.isFile()) {
      existingCandidate = await findExtractedExecutable(activeRoot, executableName, label).catch(() => '');
    }
    if (existingCandidate && await validInstalledNativeExecutable(activeRoot, existingCandidate, expectedVersion, expectedExecutableHash, options, label)) return existingCandidate;
  }

  const initialIdentity = existingRoot;
  const downloadDirectory = await mkdtemp(join(toolchainRoot, `.${kind}.download-`));
  const staging = await mkdtemp(join(parent, `.${basename(activeRoot)}.staging-`));
  const archiveName = basename(new URL(release.url).pathname) || `${kind}.archive`;
  const archive = join(downloadDirectory, archiveName);
  let stagingOwned = true;
  let rollback: string | undefined;
  try {
    const operation = { platform, env, executableName, version: expectedVersion, kind: label as 'ImageMagick' | 'oxipng' };
    const downloader = options.downloadArchive ?? defaultDownloadArchive;
    await downloader(release.url, archive, operation);
    await verifyPinnedFile(archive, `${label} archive`, expectedArchiveHash);
    const extractor = options.extractArchive ?? ((archivePath, destination, extractionOptions) => defaultExtractArchive(archivePath, destination, extractionOptions, options));
    await extractor(archive, staging, operation);
    const stagedExecutable = await findExtractedExecutable(staging, executableName, label);
    await assertNoSymlinkPath(staging, stagedExecutable, label);
    await verifyPinnedFile(stagedExecutable, label, expectedExecutableHash);
    const stagedVersionOutput = await commandVersion(runner, stagedExecutable, ['--version'], options, label);
    requireVersion(kind === 'imageMagick' ? parseImageMagickVersion(stagedVersionOutput) : parseOxipngVersion(stagedVersionOutput), expectedVersion, label);

    const currentRoot = await optionalLstat(activeRoot);
    if (initialIdentity) {
      if (!currentRoot || !samePathIdentity(initialIdentity, currentRoot)) throw new ImageWorkshopError(`${label} install directory changed during preparation; refusing to overwrite a racing path: ${activeRoot}.`);
    } else if (currentRoot) {
      throw new ImageWorkshopError(`${label} install directory appeared during preparation; refusing to overwrite a racing path: ${activeRoot}.`);
    }

    if (currentRoot) {
      rollback = join(parent, `.${basename(activeRoot)}.rollback-${randomUUID()}`);
      await renameForInstall(activeRoot, rollback);
    }
    try {
      await renameForInstall(staging, activeRoot);
      stagingOwned = false;
    } catch (error) {
      if (rollback) await renameForInstall(rollback, activeRoot).catch((restoreError) => {
        throw new ImageWorkshopError(`${label} atomic swap failed and the prior install could not be restored: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      });
      throw new ImageWorkshopError(`${label} atomic swap failed; the prior install was preserved: ${error instanceof Error ? error.message : String(error)}`);
    }

    const relativeExecutable = relative(staging, stagedExecutable);
    const installedExecutable = join(activeRoot, relativeExecutable);
    try {
      await assertNoSymlinkPath(activeRoot, installedExecutable, label);
      await verifyPinnedFile(installedExecutable, label, expectedExecutableHash);
      const installedVersionOutput = await commandVersion(runner, installedExecutable, ['--version'], options, label);
      requireVersion(kind === 'imageMagick' ? parseImageMagickVersion(installedVersionOutput) : parseOxipngVersion(installedVersionOutput), expectedVersion, label);
    } catch (error) {
      const failedRoot = join(parent, `.${basename(activeRoot)}.failed-${randomUUID()}`);
      await renameForInstall(activeRoot, failedRoot).catch(() => undefined);
      if (rollback) {
        await renameForInstall(rollback, activeRoot).catch((restoreError) => {
          throw new ImageWorkshopError(`${label} post-swap verification failed and the prior install could not be restored: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
        });
      }
      await rm(failedRoot, { recursive: true, force: true });
      throw new ImageWorkshopError(`${label} post-swap verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (rollback) await rm(rollback, { recursive: true, force: true });
    return installedExecutable;
  } catch (error) {
    if (stagingOwned) await rm(staging, { recursive: true, force: true });
    if (error instanceof ImageWorkshopError) throw error;
    throw new ImageWorkshopError(`${label} installation failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await rm(downloadDirectory, { recursive: true, force: true });
  }
}

function parseBunLock(content: string): JsonObject | undefined {
  try {
    return asObject(JSON.parse(content));
  } catch {
    try {
      return asObject(JSON.parse(content.replace(/,\s*([}\]])/g, '$1')));
    } catch {
      return undefined;
    }
  }
}

async function helperPackageInfo(helperRoot: string): Promise<{
  path: string;
  version: string;
  lockPath: string;
  lockSha256: string;
  integrity: string;
}> {
  const packagePath = join(helperRoot, 'node_modules', FREE_TEX_PACKAGE, 'package.json');
  const packageJson = await readJson(packagePath);
  const version = typeof packageJson?.version === 'string' ? packageJson.version : undefined;
  requireVersion(version, FREE_TEX_PACKER_VERSION, `${FREE_TEX_PACKAGE} in ${helperRoot}`);

  const rootPackage = await readJson(join(helperRoot, 'package.json'));
  const dependencies = asObject(rootPackage?.dependencies);
  if (dependencies?.[FREE_TEX_PACKAGE] !== FREE_TEX_PACKER_VERSION) {
    throw new ImageWorkshopError(`${FREE_TEX_PACKAGE} is not exact-pinned in ${helperRoot}/package.json.`);
  }
  const lockPath = join(helperRoot, 'bun.lock');
  const lock = parseBunLock(await readFile(lockPath, 'utf8'));
  const workspace = asObject(asObject(lock?.workspaces)?.['']);
  const lockedDependencies = asObject(workspace?.dependencies);
  const lockedPackage = asObject(lock?.packages)?.[FREE_TEX_PACKAGE];
  const integrity = Array.isArray(lockedPackage) && typeof lockedPackage[3] === 'string' ? lockedPackage[3] : undefined;
  if (lockedDependencies?.[FREE_TEX_PACKAGE] !== FREE_TEX_PACKER_VERSION || integrity !== FREE_TEX_LOCK_INTEGRITY) {
    throw new ImageWorkshopError(`bun.lock for ${FREE_TEX_PACKAGE} is missing or does not match its pinned npm integrity.`);
  }
  return {
    path: packagePath,
    version: version!,
    lockPath,
    lockSha256: await sha256File(lockPath),
    integrity: FREE_TEX_LOCK_INTEGRITY
  };
}

async function firstExecutable(names: string[], options: { platform: string; env: Record<string, string | undefined> }): Promise<string | undefined> {
  for (const name of names) {
    const found = await resolveExecutable(name, options);
    if (found) return found;
  }
  return undefined;
}

export async function detectOptionalEnhancements(options: {
  platform?: string;
  env?: Record<string, string | undefined>;
  asepriteExecutable?: string;
  texturePackerExecutable?: string;
  photoshopExecutable?: string;
} = {}): Promise<OptionalEnhancements> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const resolveConfigured = async (configured: string | undefined, names: string[]): Promise<string | undefined> => {
    if (configured) {
      const path = absoluteConfiguredPath(configured, 'Optional application executable');
      return path && await isRegularFile(path) ? path : undefined;
    }
    return firstExecutable(names, { platform, env });
  };
  const [aseprite, texturePacker, photoshop] = await Promise.all([
    resolveConfigured(options.asepriteExecutable ?? env.ASEPRITE_EXECUTABLE, platform === 'win32' ? ['aseprite.exe', 'aseprite'] : ['aseprite']),
    resolveConfigured(options.texturePackerExecutable ?? env.TEXTUREPACKER_EXECUTABLE, platform === 'win32' ? ['TexturePacker.exe', 'TexturePacker'] : ['TexturePacker']),
    resolveConfigured(options.photoshopExecutable ?? env.PHOTOSHOP_EXECUTABLE, platform === 'win32' ? ['Photoshop.exe', 'Photoshop'] : ['Photoshop'])
  ]);
  return {
    ...(aseprite ? { aseprite } : {}),
    ...(texturePacker ? { texturePacker } : {}),
    ...(photoshop ? { photoshop } : {})
  };
}

function nativeManifestValue(value: unknown, label: string, expectedVersion: string, release: ReturnType<typeof pinnedImageRelease>): NativeToolManifest {
  const object = asObject(value);
  if (!object) throw new ImageWorkshopError(`${label} is missing from the app-owned image manifest.`);
  const version = object.version;
  requireVersion(version, expectedVersion, `${label} manifest pin`);
  const url = validateUrl(object.url, expectedVersion, `${label} URL`);
  const archiveSha256 = requireSha256(object.archiveSha256, `${label} archive SHA-256`);
  const archiveMember = typeof object.archiveMember === 'string' && object.archiveMember.length > 0 ? object.archiveMember : undefined;
  if (!archiveMember) throw new ImageWorkshopError(`${label} manifest is missing the archived executable member.`);
  const sha256 = requireSha256(object.sha256, `${label} executable SHA-256`);
  if (release && (url !== release.url || archiveSha256 !== release.archiveSha256 || archiveMember !== release.executableName)) {
    throw new ImageWorkshopError(`${label} manifest URL/archive checksum is not the pinned release asset.`);
  }
  return { path: String(object.path ?? ''), version: expectedVersion, url, archiveSha256, archiveMember, sha256 };
}

export async function resolveImageToolchain(options: ImageToolchainOptions = {}): Promise<ImageToolchain> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const runner = options.commandRunner ?? runCommand;
  const toolchainRoot = imageToolchainRoot(options);
  const manifestPath = manifestPathFor(options, toolchainRoot);
  if (!isWithin(toolchainRoot, manifestPath)) throw new ImageWorkshopError(`Image tool manifest must remain inside the harness-owned toolchain directory: ${toolchainRoot}.`);
  const manifest = await readJson(manifestPath);
  if (manifest && manifest.format !== IMAGE_WORKSHOP_MANIFEST_FORMAT) {
    throw new ImageWorkshopError(`Image tool manifest ${manifestPath} has unsupported format ${String(manifest.format)}.`);
  }
  if (!manifest) {
    if (!options.imageMagickExecutable && !env.DSH_IMAGE_MAGICK) {
      throw new ImageWorkshopError(`Pinned ImageMagick ${IMAGE_MAGICK_VERSION} is not configured. Provide the app-owned manifest at ${manifestPath}.`);
    }
  }

  const release = releaseFor(options, platform, 'imageMagick');
  const manifestImage = manifest ? nativeManifestValue(manifest.imageMagick, 'ImageMagick', IMAGE_MAGICK_VERSION, release) : undefined;
  const configuredImage = options.imageMagickExecutable ?? env.DSH_IMAGE_MAGICK ?? manifestImage?.path;
  const imageMagick = absoluteConfiguredPath(configuredImage, 'ImageMagick executable');
  if (!imageMagick) throw new ImageWorkshopError(`Pinned ImageMagick ${IMAGE_MAGICK_VERSION} has no absolute executable path.`);
  const explicitImage = Boolean(options.imageMagickExecutable ?? env.DSH_IMAGE_MAGICK);
  const imageSha = requireSha256(options.imageMagickSha256 ?? env.DSH_IMAGE_MAGICK_SHA256 ?? manifestImage?.sha256 ?? (explicitImage ? undefined : release?.executableSha256), 'ImageMagick executable SHA-256');
  const imageUrl = validateUrl(options.imageMagickUrl ?? env.DSH_IMAGE_MAGICK_URL ?? manifestImage?.url ?? release?.url, IMAGE_MAGICK_VERSION, 'ImageMagick URL');
  const imageArchiveSha = requireSha256(manifestImage?.archiveSha256 ?? release?.archiveSha256, 'ImageMagick archive SHA-256');
  if (release && !explicitImage && imageSha !== release.executableSha256) throw new ImageWorkshopError('ImageMagick manifest executable SHA-256 is not the pinned release binary.');
  if (!options.imageMagickExecutable && !env.DSH_IMAGE_MAGICK && !isWithin(toolchainRoot, imageMagick)) {
    throw new ImageWorkshopError(`Manifest ImageMagick path must remain inside the harness-owned toolchain directory: ${toolchainRoot}.`);
  }
  await verifyPinnedFile(imageMagick, 'ImageMagick', imageSha);
  if (!/^magick(?:\.exe)?$/i.test(basename(imageMagick))) {
    throw new ImageWorkshopError(`ImageMagick must resolve to magick or magick.exe, not ${basename(imageMagick)}; the convert alias is not accepted.`);
  }
  const imageVersionOutput = await commandVersion(runner, imageMagick, ['--version'], options, 'ImageMagick');
  const parsedImageMagickVersion = parseImageMagickVersion(imageVersionOutput);
  requireVersion(parsedImageMagickVersion, IMAGE_MAGICK_VERSION, 'ImageMagick');

  const helperManifest = asObject(manifest?.helper);
  const configuredHelper = options.helperRoot ?? env.DSH_IMAGE_HELPER_ROOT ?? helperManifest?.root;
  const helperRoot = absoluteConfiguredPath(configuredHelper, 'Image helper root') ?? toolchainRoot;
  if (!options.helperRoot && !env.DSH_IMAGE_HELPER_ROOT && manifest && !isWithin(toolchainRoot, helperRoot)) {
    throw new ImageWorkshopError(`Manifest image helper path must remain inside the harness-owned toolchain directory: ${toolchainRoot}.`);
  }
  const helper = await helperPackageInfo(helperRoot);
  if (helperManifest) {
    if (helperManifest.root !== helperRoot || helperManifest.lockPath !== helper.lockPath) {
      throw new ImageWorkshopError('Image helper manifest paths do not match the resolved app-owned helper runtime.');
    }
    requireSha256(helperManifest.lockSha256, 'Image helper lock SHA-256');
    if (normalizeSha256(helperManifest.lockSha256 as string) !== normalizeSha256(helper.lockSha256)) {
      throw new ImageWorkshopError('Image helper bun.lock checksum does not match the app-owned manifest.');
    }
    if (helperManifest.packageVersion !== helper.version || helperManifest.integrity !== helper.integrity) {
      throw new ImageWorkshopError('Image helper manifest version/integrity does not match the verified lockfile.');
    }
  }

  const explicitlyConfiguredOxipng = options.oxipngExecutable ?? env.DSH_OXIPNG;
  const configuredOxipng = explicitlyConfiguredOxipng ?? (options.installOxipng ? (asObject(manifest?.oxipng)?.path as string | undefined) : undefined);
  let oxipng: string | undefined;
  let oxipngVersion: string | undefined;
  let oxipngSha256: string | undefined;
  let oxipngUrl: string | undefined;
  let oxipngArchiveSha256: string | undefined;
  let oxipngArchiveMember: string | undefined;
  if (configuredOxipng) {
    const releaseOxipng = releaseFor(options, platform, 'oxipng');
    const manifestOxipngValue = asObject(manifest?.oxipng);
    const manifestOxipng = manifestOxipngValue ? nativeManifestValue(manifestOxipngValue, 'oxipng', OXIPNG_VERSION, releaseOxipng) : undefined;
    oxipng = absoluteConfiguredPath(configuredOxipng, 'oxipng executable');
    if (!oxipng) throw new ImageWorkshopError('oxipng was configured but its path is empty.');
    const explicitOxipng = Boolean(explicitlyConfiguredOxipng);
    oxipngSha256 = requireSha256(options.oxipngSha256 ?? env.DSH_OXIPNG_SHA256 ?? manifestOxipng?.sha256 ?? (explicitOxipng ? undefined : releaseOxipng?.executableSha256), 'oxipng executable SHA-256');
    oxipngUrl = validateUrl(options.oxipngUrl ?? env.DSH_OXIPNG_URL ?? manifestOxipng?.url ?? releaseOxipng?.url, OXIPNG_VERSION, 'oxipng URL');
    oxipngArchiveSha256 = requireSha256(manifestOxipng?.archiveSha256 ?? releaseOxipng?.archiveSha256, 'oxipng archive SHA-256');
    if (releaseOxipng && !explicitOxipng && oxipngSha256 !== releaseOxipng.executableSha256) throw new ImageWorkshopError('oxipng manifest executable SHA-256 is not the pinned release binary.');
    oxipngArchiveMember = manifestOxipng?.archiveMember ?? releaseOxipng?.executableName;
    await verifyPinnedFile(oxipng, 'oxipng', oxipngSha256);
    if (!/^oxipng(?:\.exe)?$/i.test(basename(oxipng))) throw new ImageWorkshopError(`oxipng must resolve to oxipng or oxipng.exe, not ${basename(oxipng)}.`);
    const oxipngOutput = await commandVersion(runner, oxipng, ['--version'], options, 'oxipng');
    oxipngVersion = parseOxipngVersion(oxipngOutput);
    requireVersion(oxipngVersion, OXIPNG_VERSION, 'oxipng');
  }

  const optionalEnhancements = await detectOptionalEnhancements({ platform, env });
  return {
    toolchainRoot,
    manifestPath,
    imageMagick,
    imageMagickVersion: IMAGE_MAGICK_VERSION,
    imageMagickSha256: imageSha,
    imageMagickUrl: imageUrl,
    imageMagickArchiveSha256: imageArchiveSha,
    imageMagickArchiveMember: manifestImage?.archiveMember ?? release?.executableName,
    helperRoot,
    helperPackagePath: helper.path,
    helperPackageVersion: helper.version,
    helperLockPath: helper.lockPath,
    helperLockSha256: helper.lockSha256,
    helperIntegrity: helper.integrity,
    ...(oxipng ? { oxipng } : {}),
    ...(oxipngVersion ? { oxipngVersion } : {}),
    ...(oxipngSha256 ? { oxipngSha256 } : {}),
    ...(oxipngUrl ? { oxipngUrl } : {}),
    ...(oxipngArchiveSha256 ? { oxipngArchiveSha256 } : {}),
    ...(oxipngArchiveMember ? { oxipngArchiveMember } : {}),
    optionalEnhancements
  };
}

export const verifyImageToolchain = resolveImageToolchain;

function imageToolchainManifest(toolchain: ImageToolchain): ImageToolchainManifest {
  const imageMagick: NativeToolManifest = {
    path: toolchain.imageMagick,
    version: IMAGE_MAGICK_VERSION,
    url: validateUrl(toolchain.imageMagickUrl, IMAGE_MAGICK_VERSION, 'ImageMagick URL'),
    archiveSha256: requireSha256(toolchain.imageMagickArchiveSha256, 'ImageMagick archive SHA-256'),
    archiveMember: requireString(toolchain.imageMagickArchiveMember, 'ImageMagick archived executable member'),
    sha256: requireSha256(toolchain.imageMagickSha256, 'ImageMagick executable SHA-256')
  };
  const result: ImageToolchainManifest = {
    format: IMAGE_WORKSHOP_MANIFEST_FORMAT,
    imageMagick,
    helper: {
      root: toolchain.helperRoot,
      lockPath: toolchain.helperLockPath ?? join(toolchain.helperRoot, 'bun.lock'),
      lockSha256: requireSha256(toolchain.helperLockSha256, 'Image helper lock SHA-256'),
      packageVersion: toolchain.helperPackageVersion,
      integrity: requirePinnedIntegrity(toolchain.helperIntegrity)
    },
    optionalEnhancements: toolchain.optionalEnhancements
  };
  if (toolchain.oxipng) {
    result.oxipng = {
      path: toolchain.oxipng,
      version: OXIPNG_VERSION,
      url: validateUrl(toolchain.oxipngUrl, OXIPNG_VERSION, 'oxipng URL'),
      archiveSha256: requireSha256(toolchain.oxipngArchiveSha256, 'oxipng archive SHA-256'),
      archiveMember: requireString(toolchain.oxipngArchiveMember, 'oxipng archived executable member'),
      sha256: requireSha256(toolchain.oxipngSha256, 'oxipng executable SHA-256')
    };
  }
  return result;
}

export async function writeImageToolchainManifest(toolchain: ImageToolchain): Promise<string> {
  const manifest = imageToolchainManifest(toolchain);
  await mkdir(dirname(toolchain.manifestPath), { recursive: true });
  const temporary = join(dirname(toolchain.manifestPath), `.${basename(toolchain.manifestPath)}.tmp-${randomUUID()}`);
  try {
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await rename(temporary, toolchain.manifestPath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
  return toolchain.manifestPath;
}

async function runHelperInstall(
  runner: CommandRunner,
  bun: string,
  cwd: string,
  env: Record<string, string | undefined>
): Promise<void> {
  const packageSpec = `${FREE_TEX_PACKAGE}@${FREE_TEX_PACKER_VERSION}`;
  const args = ['add', '--exact', '--ignore-scripts', packageSpec];
  let result;
  try {
    result = await runner(bun, args, { cwd, env: withoutCredentials(env), timeoutMs: 15 * 60_000 });
  } catch (error) {
    throw new ImageWorkshopError(`Pinned image helper installation could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result.exitCode !== 0) throw new ImageWorkshopError(commandFailure(bun, args, result, env).message);
  const trustArgs = ['pm', 'trust', '--all'];
  try {
    result = await runner(bun, trustArgs, { cwd, env: withoutCredentials(env), timeoutMs: 15 * 60_000 });
  } catch (error) {
    throw new ImageWorkshopError(`Image helper native dependency trust could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result.exitCode !== 0 && !/0 scripts ran/i.test(`${result.stdout}\n${result.stderr}`)) throw new ImageWorkshopError(commandFailure(bun, trustArgs, result, env).message);
}

export async function ensureImageHelperRuntime(options: ImageHelperRuntimeOptions = {}): Promise<string> {
  const paths = resolveHarnessPaths(options);
  const env = options.env ?? process.env;
  const runtimeDir = resolve(options.helperRuntimeDir ?? options.helperRoot ?? join(paths.programRoot, DEFAULT_TOOLCHAIN_RELATIVE, 'runtime'));
  try {
    await helperPackageInfo(runtimeDir);
    return runtimeDir;
  } catch {
    // A missing or tampered helper is rebuilt in a sibling staging tree.
  }

  const stamp = (options.now ?? (() => new Date()))().toISOString().replace(/[-:.TZ]/g, '');
  const staging = join(dirname(runtimeDir), `.${basename(runtimeDir)}.staging-${stamp}-${randomUUID()}`);
  let rollbackDir: string | undefined;
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, 'package.json'), `${JSON.stringify({
    name: 'dsh-rpgmaker-image-runtime',
    private: true,
    dependencies: { [FREE_TEX_PACKAGE]: FREE_TEX_PACKER_VERSION }
  }, null, 2)}\n`);
  const runner = options.commandRunner ?? runCommand;
  const bun = options.bunExecutable ?? env.BUN_EXECUTABLE ?? 'bun';
  try {
    await runHelperInstall(runner, bun, staging, env);
    await helperPackageInfo(staging);
    await mkdir(dirname(runtimeDir), { recursive: true });
    try {
      await stat(runtimeDir);
      rollbackDir = `${runtimeDir}.rollback-${stamp}-${randomUUID()}`;
      await rename(runtimeDir, rollbackDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await rename(staging, runtimeDir);
    } catch (error) {
      if (rollbackDir) await rename(rollbackDir, runtimeDir).catch(() => undefined);
      throw error;
    }
    try {
      await helperPackageInfo(runtimeDir);
    } catch (error) {
      const failedDir = `${runtimeDir}.failed-${stamp}-${randomUUID()}`;
      await rename(runtimeDir, failedDir).catch(() => undefined);
      if (rollbackDir) {
        await rename(rollbackDir, runtimeDir).catch((restoreError) => {
          throw new ImageWorkshopError(`Image helper verification failed and the prior runtime could not be restored: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
        });
      }
      throw error;
    }
    if (rollbackDir) await rm(rollbackDir, { recursive: true, force: true });
    return runtimeDir;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error instanceof ImageWorkshopError) throw error;
    throw new ImageWorkshopError(`Pinned image helper installation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function prepareImageToolchain(options: ImageToolchainPreparationOptions = {}): Promise<ImageToolchainPreparation> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const toolchainRoot = imageToolchainRoot(options);
  const imageRelease = releaseFor(options, platform, 'imageMagick');
  const configuredImageMagick = options.imageMagickExecutable ?? env.DSH_IMAGE_MAGICK;
  let imageMagick = configuredImageMagick;
  if (!configuredImageMagick && platform === 'win32') {
    if (!imageRelease) throw new ImageWorkshopError(`Pinned ImageMagick ${IMAGE_MAGICK_VERSION} has no release asset for ${platform}-${process.arch}.`);
    imageMagick = await installPinnedNativeTool(options, toolchainRoot, 'imageMagick', imageRelease);
  }

  const explicitlyConfiguredOxipng = options.oxipngExecutable ?? env.DSH_OXIPNG;
  const installOxipng = options.installOxipng === true || env.DSH_INSTALL_OXIPNG === '1' || env.DSH_INSTALL_OXIPNG === 'true';
  const oxipngRelease = releaseFor(options, platform, 'oxipng');
  let oxipng = explicitlyConfiguredOxipng;
  if (installOxipng && !explicitlyConfiguredOxipng) {
    if (!oxipngRelease) throw new ImageWorkshopError(`Pinned oxipng ${OXIPNG_VERSION} has no release asset for ${platform}-${process.arch}.`);
    oxipng = await installPinnedNativeTool(options, toolchainRoot, 'oxipng', oxipngRelease);
  }

  const helperRuntimeDir = await ensureImageHelperRuntime(options);
  const toolchain = await resolveImageToolchain({
    ...options,
    toolchainRoot,
    helperRoot: helperRuntimeDir,
    ...(imageMagick ? { imageMagickExecutable: imageMagick } : {}),
    ...(imageMagick && imageRelease ? { imageMagickSha256: options.imageMagickSha256 ?? env.DSH_IMAGE_MAGICK_SHA256 ?? imageRelease.executableSha256, imageMagickUrl: options.imageMagickUrl ?? env.DSH_IMAGE_MAGICK_URL ?? imageRelease.url } : {}),
    ...(oxipng ? { oxipngExecutable: oxipng } : {}),
    ...(oxipng && oxipngRelease ? { oxipngSha256: options.oxipngSha256 ?? env.DSH_OXIPNG_SHA256 ?? oxipngRelease.executableSha256, oxipngUrl: options.oxipngUrl ?? env.DSH_OXIPNG_URL ?? oxipngRelease.url } : {}),
    ...(installOxipng ? { installOxipng: true } : {})
  });
  await writeImageToolchainManifest(toolchain);
  return { toolchain, helperRuntimeDir };
}

export function toolchainSummary(toolchain: ImageToolchain): {
  imageMagick: { path: string; version: string; sha256?: string };
  freeTexPacker: { root: string; version: string; lockSha256?: string; integrity?: string };
  oxipng?: { path: string; version: string; sha256?: string };
  optionalEnhancements: OptionalEnhancements;
} {
  return {
    imageMagick: { path: toolchain.imageMagick, version: toolchain.imageMagickVersion, ...(toolchain.imageMagickSha256 ? { sha256: toolchain.imageMagickSha256 } : {}) },
    freeTexPacker: {
      root: toolchain.helperRoot,
      version: toolchain.helperPackageVersion,
      ...(toolchain.helperLockSha256 ? { lockSha256: toolchain.helperLockSha256 } : {}),
      ...(toolchain.helperIntegrity ? { integrity: toolchain.helperIntegrity } : {})
    },
    ...(toolchain.oxipng && toolchain.oxipngVersion ? { oxipng: { path: toolchain.oxipng, version: toolchain.oxipngVersion, ...(toolchain.oxipngSha256 ? { sha256: toolchain.oxipngSha256 } : {}) } } : {}),
    optionalEnhancements: toolchain.optionalEnhancements
  };
}

export function defaultImageToolchainRoot(dshHome?: string): string {
  const paths = resolveHarnessPaths(dshHome ? { dshHome } : {});
  return resolve(paths.programRoot, DEFAULT_TOOLCHAIN_RELATIVE);
}

export function toolchainManifestForRoot(root: string): string {
  return join(resolve(root), IMAGE_MANIFEST_NAME);
}

export { FREE_TEX_LOCK_INTEGRITY };
