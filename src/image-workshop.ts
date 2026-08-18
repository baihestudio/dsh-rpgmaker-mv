import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { resolveHarnessPaths, type PathOptions } from './config';
import { isRegularFile } from './files';
import { pathExists } from './project';
import { resolveExecutable } from './executable';
import { commandFailure, runCommand, withoutCredentials, type CommandRunner } from './process';

export const IMAGE_MAGICK_VERSION = '7.1.2-29';
export const FREE_TEX_PACKER_VERSION = '0.3.9';
export const OXIPNG_VERSION = '10.2.0';
export const ASSET_WORKSHOP_PRESET_ID = 'asset-workshop';
export const IMAGE_WORKSHOP_MANIFEST_FORMAT = 1;

const FREE_TEX_PACKAGE = 'free-tex-packer-core';
const DEFAULT_TOOLCHAIN_RELATIVE = join('rpgmaker-mv', 'image-workshop');
const IMAGE_MANIFEST_NAME = 'toolchain.json';
const DEFAULT_MAX_PIXELS = 16_777_216;
const DEFAULT_TIMEOUT_MS = 120_000;
const RESOURCE_ARGS = [
  '-limit', 'memory', '256MiB',
  '-limit', 'map', '512MiB',
  '-limit', 'area', '128MP',
  '-limit', 'time', '120'
];
const PNG_DETERMINISM_ARGS = ['-define', 'png:exclude-chunk=date,time'];

export interface OptionalEnhancements {
  aseprite?: string;
  texturePacker?: string;
  photoshop?: string;
}

export interface ImageToolchainManifest {
  format: number;
  imageMagick: {
    path: string;
    version: string;
    sha256?: string;
  };
  helperRoot: string;
  optionalEnhancements?: OptionalEnhancements;
  oxipng?: {
    path: string;
    version: string;
    sha256?: string;
  };
}

export interface ImageToolchain {
  toolchainRoot: string;
  manifestPath: string;
  imageMagick: string;
  imageMagickVersion: string;
  helperRoot: string;
  helperPackagePath: string;
  helperPackageVersion: string;
  oxipng?: string;
  oxipngVersion?: string;
  optionalEnhancements: OptionalEnhancements;
}

export interface ImageToolchainOptions extends PathOptions {
  toolchainRoot?: string;
  manifestPath?: string;
  imageMagickExecutable?: string;
  helperRoot?: string;
  oxipngExecutable?: string;
  verifyOxipng?: boolean;
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
  imageMagickSha256?: string;
  oxipngSha256?: string;
}

export interface ImageToolchainPreparation {
  toolchain: ImageToolchain;
  helperRuntimeDir: string;
}

export interface ImageWorkshopDependencies {
  commandRunner?: CommandRunner;
  platform?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxPixels?: number;
}

export interface ImageMetadata {
  path: string;
  width: number;
  height: number;
  format: string;
  channels: string;
  hasAlpha: boolean;
  opaque: boolean;
  bytes: number;
  sha256: string;
}

export interface ImageOperationResult {
  operation: string;
  outputPaths: string[];
  manifestPath: string;
  manifest: ImageOperationManifest;
}

export interface ImageOperationManifest {
  schemaVersion: 1;
  operation: string;
  toolchain: {
    imageMagick: { path: string; version: string };
    freeTexPacker: { root: string; version: string };
    oxipng?: { path: string; version: string };
    optionalEnhancements: OptionalEnhancements;
  };
  inputs: ImageMetadata[];
  outputs: ImageMetadata[];
  options: Record<string, unknown>;
  fidelity: Record<string, unknown>;
  lossless: boolean;
}

export interface ResizePixelOptions {
  input: string;
  output: string;
  scale?: number;
  width?: number;
  height?: number;
}

export interface TrimPadOptions {
  input: string;
  output: string;
  trim?: boolean;
  width?: number;
  height?: number;
  gravity?: 'center' | 'north' | 'south' | 'east' | 'west' | 'northeast' | 'northwest' | 'southeast' | 'southwest';
}

export interface SheetSliceOptions {
  input: string;
  outputDir: string;
  cellWidth: number;
  cellHeight: number;
}

export interface SheetAssembleOptions {
  inputs: string[];
  output: string;
  columns: number;
}

export interface AtlasPackOptions {
  inputs: string[];
  output: string;
  maxSize: number;
  padding?: number;
  extrusion?: number;
  fixedGrid?: boolean;
}

export interface OptimizePngOptions {
  input: string;
  output: string;
  level?: number;
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
  return resolve(options.toolchainRoot ?? env.DSH_IMAGE_WORKSHOP_ROOT ?? join(paths.dshHome, DEFAULT_TOOLCHAIN_RELATIVE));
}

function manifestPathFor(options: ImageToolchainOptions, root: string): string {
  const env = options.env ?? process.env;
  return resolve(options.manifestPath ?? env.DSH_IMAGE_WORKSHOP_MANIFEST ?? join(root, IMAGE_MANIFEST_NAME));
}

function absoluteConfiguredPath(value: unknown, label: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const result = resolve(value);
  if (!result || result !== value && !value.startsWith('\\\\') && !/^[A-Za-z]:[\\/]/.test(value) && !value.startsWith('/')) {
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

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
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

async function verifyPinnedFile(path: string, label: string, expectedHash?: string): Promise<void> {
  if (!(await isRegularFile(path))) throw new ImageWorkshopError(`${label} was not found at resolved path ${path}. Install or repair the app-owned image toolchain.`);
  if (expectedHash) {
    const actual = await sha256File(path);
    if (normalizeSha256(actual) !== normalizeSha256(expectedHash)) {
      throw new ImageWorkshopError(`${label} checksum does not match the tool manifest at ${path}.`);
    }
  }
}

async function helperPackageInfo(helperRoot: string): Promise<{ path: string; version: string }> {
  const path = join(helperRoot, 'node_modules', FREE_TEX_PACKAGE, 'package.json');
  const packageJson = await readJson(path);
  const version = typeof packageJson?.version === 'string' ? packageJson.version : undefined;
  requireVersion(version, FREE_TEX_PACKER_VERSION, `${FREE_TEX_PACKAGE} in ${helperRoot}`);
  return { path, version: version! };
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

export async function resolveImageToolchain(options: ImageToolchainOptions = {}): Promise<ImageToolchain> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const runner = options.commandRunner ?? runCommand;
  const toolchainRoot = imageToolchainRoot(options);
  const manifestPath = manifestPathFor(options, toolchainRoot);
  const manifest = await readJson(manifestPath);
  const manifestImage = asObject(manifest?.imageMagick);
  const manifestOxipng = asObject(manifest?.oxipng);
  if (manifest && manifest.format !== IMAGE_WORKSHOP_MANIFEST_FORMAT) {
    throw new ImageWorkshopError(`Image tool manifest ${manifestPath} has unsupported format ${String(manifest.format)}.`);
  }

  const configuredImage = options.imageMagickExecutable ?? env.DSH_IMAGE_MAGICK ?? manifestImage?.path;
  const imageMagick = absoluteConfiguredPath(configuredImage, 'ImageMagick executable');
  if (!imageMagick) throw new ImageWorkshopError(`Pinned ImageMagick ${IMAGE_MAGICK_VERSION} is not configured. Provide an app-owned tool manifest at ${manifestPath}.`);
  await verifyPinnedFile(imageMagick, 'ImageMagick', typeof manifestImage?.sha256 === 'string' ? manifestImage.sha256 : undefined);
  if (!/^magick(?:\.exe)?$/i.test(basename(imageMagick))) {
    throw new ImageWorkshopError(`ImageMagick must resolve to magick or magick.exe, not ${basename(imageMagick)}; the convert alias is not accepted.`);
  }
  const imageVersionOutput = await commandVersion(runner, imageMagick, ['--version'], options, 'ImageMagick');
  const parsedImageMagickVersion = parseImageMagickVersion(imageVersionOutput);
  requireVersion(parsedImageMagickVersion, IMAGE_MAGICK_VERSION, 'ImageMagick');
  const imageMagickVersion = parsedImageMagickVersion!;
  if (typeof manifestImage?.version === 'string') requireVersion(manifestImage.version, IMAGE_MAGICK_VERSION, 'ImageMagick manifest pin');

  const configuredHelper = options.helperRoot ?? env.DSH_IMAGE_HELPER_ROOT ?? manifest?.helperRoot;
  const helperRoot = absoluteConfiguredPath(configuredHelper, 'Image helper root') ?? toolchainRoot;
  const helper = await helperPackageInfo(helperRoot);

  const configuredOxipng = options.oxipngExecutable ?? env.DSH_OXIPNG ?? manifestOxipng?.path;
  let oxipng: string | undefined;
  let oxipngVersion: string | undefined;
  if (configuredOxipng) {
    oxipng = absoluteConfiguredPath(configuredOxipng, 'oxipng executable');
    if (!oxipng) throw new ImageWorkshopError('oxipng was configured but its path is empty.');
    await verifyPinnedFile(oxipng, 'oxipng', typeof manifestOxipng?.sha256 === 'string' ? manifestOxipng.sha256 : undefined);
    if (!/^oxipng(?:\.exe)?$/i.test(basename(oxipng))) throw new ImageWorkshopError(`oxipng must resolve to oxipng or oxipng.exe, not ${basename(oxipng)}.`);
    if (typeof manifestOxipng?.version === 'string') requireVersion(manifestOxipng.version, OXIPNG_VERSION, 'oxipng manifest pin');
    if (options.verifyOxipng) {
      const oxipngOutput = await commandVersion(runner, oxipng, ['--version'], options, 'oxipng');
      oxipngVersion = parseOxipngVersion(oxipngOutput);
      requireVersion(oxipngVersion, OXIPNG_VERSION, 'oxipng');
    } else if (typeof manifestOxipng?.version === 'string') {
      oxipngVersion = manifestOxipng.version;
    }
  }

  const optionalEnhancements = await detectOptionalEnhancements({ platform, env });
  return {
    toolchainRoot,
    manifestPath,
    imageMagick,
    imageMagickVersion,
    helperRoot,
    helperPackagePath: helper.path,
    helperPackageVersion: helper.version,
    ...(oxipng ? { oxipng } : {}),
    ...(oxipngVersion ? { oxipngVersion } : {}),
    optionalEnhancements
  };
}

export const verifyImageToolchain = resolveImageToolchain;

function imageToolchainManifest(toolchain: ImageToolchain, options: ImageToolchainPreparationOptions): ImageToolchainManifest {
  const result: ImageToolchainManifest = {
    format: IMAGE_WORKSHOP_MANIFEST_FORMAT,
    imageMagick: {
      path: toolchain.imageMagick,
      version: IMAGE_MAGICK_VERSION,
      ...(options.imageMagickSha256 ? { sha256: options.imageMagickSha256 } : {})
    },
    helperRoot: toolchain.helperRoot,
    optionalEnhancements: toolchain.optionalEnhancements
  };
  if (toolchain.oxipng) {
    result.oxipng = {
      path: toolchain.oxipng,
      version: OXIPNG_VERSION,
      ...(options.oxipngSha256 ? { sha256: options.oxipngSha256 } : {})
    };
  }
  return result;
}

export async function writeImageToolchainManifest(toolchain: ImageToolchain, options: ImageToolchainPreparationOptions = {}): Promise<string> {
  const manifest = imageToolchainManifest(toolchain, options);
  await mkdir(dirname(toolchain.manifestPath), { recursive: true });
  await writeFile(toolchain.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return toolchain.manifestPath;
}

function helperPackageVersionAt(root: string): Promise<string | undefined> {
  return readJson(join(root, 'node_modules', FREE_TEX_PACKAGE, 'package.json')).then((value) => typeof value?.version === 'string' ? value.version : undefined);
}

async function runHelperInstall(
  runner: CommandRunner,
  bun: string,
  cwd: string,
  env: Record<string, string | undefined>
): Promise<void> {
  const packageSpec = `${FREE_TEX_PACKAGE}@${FREE_TEX_PACKER_VERSION}`;
  let result;
  try {
    result = await runner(bun, ['add', '--exact', '--ignore-scripts', packageSpec], { cwd, env: withoutCredentials(env), timeoutMs: 15 * 60_000 });
  } catch (error) {
    throw new ImageWorkshopError(`Pinned image helper installation could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result.exitCode !== 0) throw new ImageWorkshopError(commandFailure(bun, ['add', '--exact', '--ignore-scripts', packageSpec], result, env).message);
  try {
    result = await runner(bun, ['pm', 'trust', '--all'], { cwd, env: withoutCredentials(env), timeoutMs: 15 * 60_000 });
  } catch (error) {
    throw new ImageWorkshopError(`Image helper native dependency trust could not start: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result.exitCode !== 0) throw new ImageWorkshopError(commandFailure(bun, ['pm', 'trust', '--all'], result, env).message);
}

export async function ensureImageHelperRuntime(options: ImageHelperRuntimeOptions = {}): Promise<string> {
  const paths = resolveHarnessPaths(options);
  const env = options.env ?? process.env;
  const runtimeDir = resolve(options.helperRuntimeDir ?? options.helperRoot ?? join(paths.dshHome, DEFAULT_TOOLCHAIN_RELATIVE, 'runtime'));
  if (await helperPackageVersionAt(runtimeDir) === FREE_TEX_PACKER_VERSION) return runtimeDir;

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
    const stagedVersion = await helperPackageVersionAt(staging);
    requireVersion(stagedVersion, FREE_TEX_PACKER_VERSION, 'staged image helper');
    await mkdir(dirname(runtimeDir), { recursive: true });
    if (await pathExists(runtimeDir)) {
      rollbackDir = `${runtimeDir}.rollback-${stamp}-${randomUUID()}`;
      await rename(runtimeDir, rollbackDir);
    }
    try {
      await rename(staging, runtimeDir);
    } catch (error) {
      if (rollbackDir && await pathExists(rollbackDir) && !(await pathExists(runtimeDir))) {
        await rename(rollbackDir, runtimeDir);
      }
      throw error;
    }
    return runtimeDir;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error instanceof ImageWorkshopError) throw error;
    throw new ImageWorkshopError(`Pinned image helper installation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function prepareImageToolchain(options: ImageToolchainPreparationOptions = {}): Promise<ImageToolchainPreparation> {
  const helperRuntimeDir = await ensureImageHelperRuntime(options);
  const toolchainRoot = imageToolchainRoot(options);
  const toolchain = await resolveImageToolchain({
    ...options,
    toolchainRoot,
    helperRoot: helperRuntimeDir
  });
  await writeImageToolchainManifest(toolchain, options);
  return { toolchain, helperRuntimeDir };
}

function toolchainSummary(toolchain: ImageToolchain): ImageOperationManifest['toolchain'] {
  return {
    imageMagick: { path: toolchain.imageMagick, version: toolchain.imageMagickVersion },
    freeTexPacker: { root: toolchain.helperRoot, version: toolchain.helperPackageVersion },
    ...(toolchain.oxipng && toolchain.oxipngVersion ? { oxipng: { path: toolchain.oxipng, version: toolchain.oxipngVersion } } : {}),
    optionalEnhancements: toolchain.optionalEnhancements
  };
}

function numberOption(value: number | undefined, label: string, minimum = 1): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < minimum) throw new ImageWorkshopError(`${label} must be an integer greater than or equal to ${minimum}.`);
  return value;
}

function alphaOption(hasAlpha: boolean): string[] {
  return ['-alpha', hasAlpha ? 'on' : 'off'];
}

function resolvedInput(path: string, label = 'Input'): string {
  if (!path) throw new ImageWorkshopError(`${label} path is required.`);
  return resolve(path);
}

async function assertInput(path: string): Promise<void> {
  if (!(await isRegularFile(path))) throw new ImageWorkshopError(`Input image does not exist or is not a regular file: ${path}`);
}

async function assertOutputPaths(outputs: string[], inputs: string[]): Promise<void> {
  const inputSet = new Set(inputs.map((value) => resolve(value)));
  const seen = new Set<string>();
  for (const output of outputs) {
    const normalized = resolve(output);
    if (inputSet.has(normalized)) throw new ImageWorkshopError(`Refusing to overwrite source image: ${normalized}`);
    if (seen.has(normalized)) throw new ImageWorkshopError(`Output paths collide with one another: ${normalized}`);
    seen.add(normalized);
    if (await pathExists(normalized)) throw new ImageWorkshopError(`Refusing to overwrite existing output: ${normalized}`);
  }
  for (const output of outputs) await mkdir(dirname(output), { recursive: true });
}

function manifestPathForOutput(output: string): string {
  return `${output}.manifest.json`;
}

async function removeCreated(paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => undefined)));
}

function parseInfo(text: string, path: string): { width: number; height: number; format: string; channels: string; opaque: boolean } {
  const line = text.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
  const fields = line?.split('|');
  const width = Number(fields?.[0]);
  const height = Number(fields?.[1]);
  const format = fields?.[2];
  const channels = fields?.[3];
  const opaqueValue = fields?.[4];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || !format || !channels || opaqueValue === undefined) {
    throw new ImageWorkshopError(`ImageMagick returned malformed metadata for ${path}.`);
  }
  return { width, height, format, channels, opaque: /^true$/i.test(opaqueValue) };
}

interface PixelGrid {
  width: number;
  height: number;
  pixels: string[];
}

function parsePixelGrid(text: string, path: string): PixelGrid {
  const header = text.match(/pixel enumeration:\s*(\d+),(\d+)/i);
  if (!header) throw new ImageWorkshopError(`ImageMagick returned malformed pixel data for ${path}.`);
  const width = Number(header[1]);
  const height = Number(header[2]);
  const pixels = new Array<string>(width * height);
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(\d+),(\d+):.*#([0-9a-f]+)\b/i);
    if (!match) continue;
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (x < width && y < height) pixels[y * width + x] = match[3].toUpperCase();
  }
  if (pixels.some((value) => value === undefined)) throw new ImageWorkshopError(`ImageMagick returned incomplete pixel data for ${path}.`);
  return { width, height, pixels };
}

function alphaValue(pixel: string): number {
  return pixel.length >= 8 ? Number.parseInt(pixel.slice(-2), 16) : 255;
}

function alphaBounds(grid: PixelGrid): { left: number; top: number; right: number; bottom: number } | undefined {
  let left = grid.width;
  let top = grid.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (alphaValue(grid.pixels[y * grid.width + x]) > 0) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right < 0 ? undefined : { left, top, right, bottom };
}

function assertSameGrid(actual: PixelGrid, expected: PixelGrid, label: string): void {
  if (actual.width !== expected.width || actual.height !== expected.height) throw new ImageWorkshopError(`${label} fidelity check failed: dimensions differ.`);
  for (let index = 0; index < actual.pixels.length; index += 1) {
    if (actual.pixels[index] !== expected.pixels[index]) throw new ImageWorkshopError(`${label} fidelity check failed at pixel ${index}.`);
  }
}

function cropGrid(source: PixelGrid, left: number, top: number, width: number, height: number): PixelGrid {
  const pixels: string[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) pixels.push(source.pixels[(top + y) * source.width + left + x]);
  }
  return { width, height, pixels };
}

function placeGrid(source: PixelGrid, width: number, height: number, gravity: NonNullable<TrimPadOptions['gravity']>): PixelGrid {
  const pixels = new Array<string>(width * height).fill('00000000');
  const horizontalCenter = Math.floor((width - source.width) / 2);
  const verticalCenter = Math.floor((height - source.height) / 2);
  const left = gravity.endsWith('east') || gravity === 'east' || gravity === 'northeast' || gravity === 'southeast'
    ? width - source.width
    : gravity.endsWith('west') || gravity === 'west' || gravity === 'northwest' || gravity === 'southwest'
      ? 0
      : horizontalCenter;
  const top = gravity.startsWith('south') || gravity === 'south' || gravity === 'southeast' || gravity === 'southwest'
    ? height - source.height
    : gravity.startsWith('north') || gravity === 'north' || gravity === 'northeast' || gravity === 'northwest'
      ? 0
      : verticalCenter;
  for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) pixels[(top + y) * width + left + x] = source.pixels[y * source.width + x];
  return { width, height, pixels };
}

function assembleGrid(inputs: PixelGrid[], columns: number): PixelGrid {
  const cellWidth = inputs[0].width;
  const cellHeight = inputs[0].height;
  const rows = inputs.length / columns;
  const pixels: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let y = 0; y < cellHeight; y += 1) {
      for (let column = 0; column < columns; column += 1) {
        const source = inputs[row * columns + column];
        pixels.push(...source.pixels.slice(y * cellWidth, (y + 1) * cellWidth));
      }
    }
  }
  return { width: cellWidth * columns, height: cellHeight * rows, pixels };
}

function resizeGrid(source: PixelGrid, scale: number): PixelGrid {
  const pixels: string[] = [];
  for (let y = 0; y < source.height; y += 1) {
    for (let sy = 0; sy < scale; sy += 1) {
      for (let x = 0; x < source.width; x += 1) {
        for (let sx = 0; sx < scale; sx += 1) pixels.push(source.pixels[y * source.width + x]);
      }
    }
  }
  return { width: source.width * scale, height: source.height * scale, pixels };
}

function fixedGridFrames(width: number, height: number, cellWidth: number, cellHeight: number): Array<{ index: number; x: number; y: number; width: number; height: number }> {
  const frames: Array<{ index: number; x: number; y: number; width: number; height: number }> = [];
  let index = 0;
  for (let y = 0; y < height; y += cellHeight) {
    for (let x = 0; x < width; x += cellWidth) frames.push({ index: index++, x, y, width: cellWidth, height: cellHeight });
  }
  return frames;
}

async function inspectWith(
  toolchain: ImageToolchain,
  pathInput: string,
  dependencies: ImageWorkshopDependencies
): Promise<ImageMetadata> {
  const path = resolve(pathInput);
  await assertInput(path);
  const runner = dependencies.commandRunner ?? runCommand;
  const env = dependencies.env ?? process.env;
  let result;
  const args = [...RESOURCE_ARGS, path, '-format', '%w|%h|%m|%[channels]|%[opaque]', 'info:'];
  try {
    result = await runner(toolchain.imageMagick, args, {
      env: withoutCredentials(env),
      platform: dependencies.platform ?? process.platform,
      timeoutMs: dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS
    });
  } catch (error) {
    throw new ImageWorkshopError(`ImageMagick inspect failed for ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result.exitCode !== 0) throw new ImageWorkshopError(commandFailure(toolchain.imageMagick, args, result, env).message);
  const info = parseInfo(result.stdout, path);
  const file = await stat(path);
  const maxPixels = dependencies.maxPixels ?? DEFAULT_MAX_PIXELS;
  if (info.width * info.height > maxPixels) throw new ImageWorkshopError(`Image ${path} is ${info.width}x${info.height}; resource limit is ${maxPixels} pixels.`);
  return {
    path,
    width: info.width,
    height: info.height,
    format: info.format,
    channels: info.channels,
    hasAlpha: /a/i.test(info.channels),
    opaque: info.opaque,
    bytes: file.size,
    sha256: await sha256File(path)
  };
}

export class ImageWorkshop {
  constructor(
    readonly toolchain: ImageToolchain,
    readonly dependencies: ImageWorkshopDependencies = {}
  ) {}

  async inspect(input: string): Promise<ImageMetadata> {
    return inspectWith(this.toolchain, input, this.dependencies);
  }

  private async magick(operation: string, args: string[]): Promise<void> {
    const runner = this.dependencies.commandRunner ?? runCommand;
    const env = this.dependencies.env ?? process.env;
    const fullArgs = [...RESOURCE_ARGS, ...args];
    let result;
    try {
      result = await runner(this.toolchain.imageMagick, fullArgs, {
        env: withoutCredentials(env),
        platform: this.dependencies.platform ?? process.platform,
        timeoutMs: this.dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS
      });
    } catch (error) {
      throw new ImageWorkshopError(`ImageMagick ${operation} could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.exitCode !== 0) throw new ImageWorkshopError(`ImageMagick ${operation} failed: ${commandFailure(this.toolchain.imageMagick, fullArgs, result, env).message}`);
  }

  private async pixels(path: string): Promise<PixelGrid> {
    const runner = this.dependencies.commandRunner ?? runCommand;
    const env = this.dependencies.env ?? process.env;
    const args = [...RESOURCE_ARGS, resolve(path), '-alpha', 'on', '-depth', '8', '-colorspace', 'sRGB', '-compress', 'none', 'txt:-'];
    let result;
    try {
      result = await runner(this.toolchain.imageMagick, args, {
        env: withoutCredentials(env),
        platform: this.dependencies.platform ?? process.platform,
        timeoutMs: this.dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS
      });
    } catch (error) {
      throw new ImageWorkshopError(`ImageMagick pixel verification could not start for ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.exitCode !== 0) throw new ImageWorkshopError(`ImageMagick pixel verification failed: ${commandFailure(this.toolchain.imageMagick, args, result, env).message}`);
    if (result.stdout.length > 4 * 1024 * 1024) throw new ImageWorkshopError(`Pixel fidelity output for ${path} exceeded the 4 MiB verification limit.`);
    return parsePixelGrid(result.stdout, resolve(path));
  }

  private async finish(
    operation: string,
    inputs: ImageMetadata[],
    outputs: string[],
    options: Record<string, unknown>,
    fidelity: Record<string, unknown>,
    lossless: boolean
  ): Promise<ImageOperationResult> {
    const outputMetadata = await Promise.all(outputs.map((path) => this.inspect(path)));
    const manifestPath = manifestPathForOutput(outputs[0]);
    await assertOutputPaths([manifestPath], inputs.map((input) => input.path));
    const manifest: ImageOperationManifest = {
      schemaVersion: 1,
      operation,
      toolchain: toolchainSummary(this.toolchain),
      inputs,
      outputs: outputMetadata,
      options,
      fidelity,
      lossless
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return { operation, outputPaths: outputs, manifestPath, manifest };
  }

  async resizePixel(options: ResizePixelOptions): Promise<ImageOperationResult> {
    const input = resolvedInput(options.input);
    const output = resolvedInput(options.output, 'Output');
    const inputInfo = await this.inspect(input);
    const sourceGrid = await this.pixels(input);
    let scale = numberOption(options.scale, 'Scale');
    if (scale === undefined) {
      const width = numberOption(options.width, 'Width');
      const height = numberOption(options.height, 'Height');
      if (width === undefined || height === undefined) throw new ImageWorkshopError('Pixel resize requires scale or both width and height.');
      const widthScale = width / inputInfo.width;
      const heightScale = height / inputInfo.height;
      if (!Number.isInteger(widthScale) || widthScale !== heightScale || widthScale < 1) {
        throw new ImageWorkshopError(`Pixel-safe resize requires one integer scale; requested ${width}x${height} from ${inputInfo.width}x${inputInfo.height}.`);
      }
      scale = widthScale;
    }
    const expectedWidth = inputInfo.width * scale;
    const expectedHeight = inputInfo.height * scale;
    const maxPixels = this.dependencies.maxPixels ?? DEFAULT_MAX_PIXELS;
    if (expectedWidth * expectedHeight > maxPixels) throw new ImageWorkshopError(`Pixel resize output would exceed the ${maxPixels}-pixel resource limit.`);
    if (options.width !== undefined || options.height !== undefined) {
      if (options.width !== undefined && options.width !== expectedWidth || options.height !== undefined && options.height !== expectedHeight) {
        throw new ImageWorkshopError('Pixel resize width/height do not match the integer scale.');
      }
    }
    const manifestPath = manifestPathForOutput(output);
    await assertOutputPaths([output, manifestPath], [input]);
    const created = [output, manifestPath];
    try {
      await this.magick('pixel resize', [input, ...alphaOption(inputInfo.hasAlpha), '-filter', 'point', '-resize', `${inputInfo.width * scale}x${inputInfo.height * scale}!`, ...PNG_DETERMINISM_ARGS, output]);
      const outputInfo = await this.inspect(output);
      if (outputInfo.width !== inputInfo.width * scale || outputInfo.height !== inputInfo.height * scale) throw new ImageWorkshopError('Pixel resize output dimensions did not match the requested integer scale.');
      if (outputInfo.hasAlpha !== inputInfo.hasAlpha) throw new ImageWorkshopError('Pixel resize changed the source alpha channel.');
      const expected = resizeGrid(sourceGrid, scale);
      const actual = await this.pixels(output);
      assertSameGrid(actual, expected, 'Pixel resize');
      return await this.finish('resize-pixel', [inputInfo], [output], { scale, filter: 'point', sourceOverwrite: false }, { dimensions: true, alphaPreserved: outputInfo.hasAlpha === inputInfo.hasAlpha, nearestNeighbor: true, pixelsMatch: true }, true);
    } catch (error) {
      await removeCreated(created);
      throw error;
    }
  }

  async trimPad(options: TrimPadOptions): Promise<ImageOperationResult> {
    const input = resolvedInput(options.input);
    const output = resolvedInput(options.output, 'Output');
    const inputInfo = await this.inspect(input);
    const sourceGrid = await this.pixels(input);
    const trim = options.trim ?? true;
    const width = numberOption(options.width, 'Canvas width');
    const height = numberOption(options.height, 'Canvas height');
    if ((width === undefined) !== (height === undefined)) throw new ImageWorkshopError('Canvas width and height must be supplied together.');
    const bounds = trim ? alphaBounds(sourceGrid) : undefined;
    const trimmedWidth = bounds ? bounds.right - bounds.left + 1 : inputInfo.width;
    const trimmedHeight = bounds ? bounds.bottom - bounds.top + 1 : inputInfo.height;
    if (width !== undefined && (width < trimmedWidth || height! < trimmedHeight)) throw new ImageWorkshopError(`Transparent padding canvas ${width}x${height} is smaller than the ${trimmedWidth}x${trimmedHeight} trimmed image.`);
    if (width !== undefined && width * height! > (this.dependencies.maxPixels ?? DEFAULT_MAX_PIXELS)) throw new ImageWorkshopError(`Trim/pad output would exceed the ${(this.dependencies.maxPixels ?? DEFAULT_MAX_PIXELS)}-pixel resource limit.`);
    const manifestPath = manifestPathForOutput(output);
    await assertOutputPaths([output, manifestPath], [input]);
    const created = [output, manifestPath];
    try {
      const args = [input, ...alphaOption(inputInfo.hasAlpha)];
      if (trim) args.push('-trim', '+repage');
      if (width !== undefined) args.push('-background', 'none', '-gravity', options.gravity ?? 'center', '-extent', `${width}x${height}`);
      args.push(...PNG_DETERMINISM_ARGS, output);
      await this.magick('trim/pad', args);
      const outputInfo = await this.inspect(output);
      if (width !== undefined && (outputInfo.width !== width || outputInfo.height !== height)) throw new ImageWorkshopError('Trim/pad output dimensions did not match the requested transparent canvas.');
      if (outputInfo.hasAlpha !== inputInfo.hasAlpha) throw new ImageWorkshopError('Trim/pad changed the source alpha channel.');
      const outputGrid = await this.pixels(output);
      const trimmedGrid = bounds ? cropGrid(sourceGrid, bounds.left, bounds.top, trimmedWidth, trimmedHeight) : sourceGrid;
      const expectedGrid = width !== undefined ? placeGrid(trimmedGrid, width, height!, options.gravity ?? 'center') : trimmedGrid;
      assertSameGrid(outputGrid, expectedGrid, 'Trim/pad');
      const transparentPadding = width !== undefined && outputGrid.pixels.some((pixel, index) => {
        const x = index % outputGrid.width;
        const y = Math.floor(index / outputGrid.width);
        return (x === 0 || y === 0 || x === outputGrid.width - 1 || y === outputGrid.height - 1) && alphaValue(pixel) === 0;
      });
      return await this.finish('trim-pad', [inputInfo], [output], { trim, canvas: width !== undefined ? { width, height } : undefined, gravity: options.gravity ?? 'center', sourceOverwrite: false }, { dimensions: true, alphaPreserved: outputInfo.hasAlpha === inputInfo.hasAlpha, sourceAlphaBounds: bounds ?? null, trimmedSize: { width: trimmedWidth, height: trimmedHeight }, transparentPadding }, true);
    } catch (error) {
      await removeCreated(created);
      throw error;
    }
  }

  async sheetSlice(options: SheetSliceOptions): Promise<ImageOperationResult> {
    const input = resolvedInput(options.input);
    const outputDir = resolvedInput(options.outputDir, 'Output directory');
    const cellWidth = numberOption(options.cellWidth, 'Cell width');
    const cellHeight = numberOption(options.cellHeight, 'Cell height');
    if (cellWidth === undefined || cellHeight === undefined) throw new ImageWorkshopError('Sheet slicing requires cell width and height.');
    const inputInfo = await this.inspect(input);
    if (inputInfo.width % cellWidth! !== 0 || inputInfo.height % cellHeight! !== 0) throw new ImageWorkshopError(`Sheet dimensions ${inputInfo.width}x${inputInfo.height} are not divisible by cell ${cellWidth}x${cellHeight}.`);
    const frames = fixedGridFrames(inputInfo.width, inputInfo.height, cellWidth!, cellHeight!);
    if (frames.length > 4096) throw new ImageWorkshopError('Sheet slicing is bounded to 4096 frames.');
    const outputs = frames.map((frame) => join(outputDir, `frame-${String(frame.index).padStart(4, '0')}.png`));
    const manifestPath = join(outputDir, 'manifest.json');
    await assertOutputPaths([...outputs, manifestPath], [input]);
    const created = [...outputs, manifestPath];
    try {
      await this.magick('sheet slicing', [input, ...alphaOption(inputInfo.hasAlpha), '-crop', `${cellWidth}x${cellHeight}`, '+repage', ...PNG_DETERMINISM_ARGS, join(outputDir, 'frame-%04d.png')]);
      const sourceGrid = await this.pixels(input);
      for (const frame of frames) {
        if (!(await isRegularFile(outputs[frame.index]))) throw new ImageWorkshopError(`Sheet slicing did not produce expected frame ${outputs[frame.index]}.`);
        const frameInfo = await this.inspect(outputs[frame.index]);
        if (frameInfo.width !== cellWidth || frameInfo.height !== cellHeight || frameInfo.hasAlpha !== inputInfo.hasAlpha) throw new ImageWorkshopError(`Sheet frame ${frame.index} failed dimensions or alpha verification.`);
        assertSameGrid(await this.pixels(outputs[frame.index]), cropGrid(sourceGrid, frame.x, frame.y, frame.width, frame.height), `Sheet frame ${frame.index}`);
      }
      const manifest: ImageOperationManifest = {
        schemaVersion: 1,
        operation: 'sheet-slice',
        toolchain: toolchainSummary(this.toolchain),
        inputs: [inputInfo],
        outputs: await Promise.all(outputs.map((path) => this.inspect(path))),
        options: { cellWidth, cellHeight, order: 'row-major', sourceOverwrite: false },
        fidelity: { dimensions: true, alphaPreserved: true, frames: frames.map((frame) => ({ index: frame.index, x: frame.x, y: frame.y, width: frame.width, height: frame.height })), pixelsMatch: true },
        lossless: true
      };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      return { operation: 'sheet-slice', outputPaths: outputs, manifestPath, manifest };
    } catch (error) {
      await removeCreated(created);
      throw error;
    }
  }

  async sheetAssemble(options: SheetAssembleOptions): Promise<ImageOperationResult> {
    if (options.inputs.length === 0) throw new ImageWorkshopError('Sheet assembly requires at least one input.');
    if (options.inputs.length > 256) throw new ImageWorkshopError('Sheet assembly is bounded to 256 input cells.');
    const inputs = options.inputs.map((path) => resolvedInput(path));
    const output = resolvedInput(options.output, 'Output');
    const columns = numberOption(options.columns, 'Columns');
    if (columns === undefined) throw new ImageWorkshopError('Sheet assembly requires columns.');
    if (inputs.length % columns !== 0) throw new ImageWorkshopError(`Sheet assembly requires an input count divisible by columns (${columns}).`);
    const inputInfo = await Promise.all(inputs.map((path) => this.inspect(path)));
    const assembledWidth = inputInfo[0].width * columns;
    const assembledHeight = inputInfo[0].height * (inputs.length / columns);
    if (assembledWidth * assembledHeight > (this.dependencies.maxPixels ?? DEFAULT_MAX_PIXELS)) throw new ImageWorkshopError(`Sheet assembly output would exceed the ${(this.dependencies.maxPixels ?? DEFAULT_MAX_PIXELS)}-pixel resource limit.`);
    if (inputInfo.some((info) => info.width !== inputInfo[0].width || info.height !== inputInfo[0].height || info.hasAlpha !== inputInfo[0].hasAlpha)) throw new ImageWorkshopError('Sheet assembly inputs must have matching dimensions and alpha mode.');
    const manifestPath = manifestPathForOutput(output);
    await assertOutputPaths([output, manifestPath], inputs);
    const created = [output, manifestPath];
    const temporary = await mkdtemp(join(tmpdir(), 'dsh-image-assemble-'));
    try {
      const rowPaths: string[] = [];
      for (let row = 0; row < inputs.length / columns!; row += 1) {
        const rowPath = join(temporary, `row-${String(row).padStart(4, '0')}.png`);
        rowPaths.push(rowPath);
        await this.magick('sheet row assembly', [...inputs.slice(row * columns!, (row + 1) * columns!), ...alphaOption(inputInfo[0].hasAlpha), '+append', ...PNG_DETERMINISM_ARGS, rowPath]);
      }
      await this.magick('sheet assembly', [...rowPaths, ...alphaOption(inputInfo[0].hasAlpha), '-append', ...PNG_DETERMINISM_ARGS, output]);
      const outputInfo = await this.inspect(output);
      const sourceGrids = await Promise.all(inputs.map((path) => this.pixels(path)));
      assertSameGrid(await this.pixels(output), assembleGrid(sourceGrids, columns!), 'Sheet assembly');
      return await this.finish('sheet-assemble', inputInfo, [output], { columns, order: 'row-major', sourceOverwrite: false }, { dimensions: true, alphaPreserved: outputInfo.hasAlpha === inputInfo[0].hasAlpha, pixelsMatch: true }, true);
    } catch (error) {
      await removeCreated(created);
      throw error;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async atlasPack(options: AtlasPackOptions): Promise<ImageOperationResult> {
    if (options.inputs.length === 0) throw new ImageWorkshopError('Atlas packing requires at least one input.');
    if (options.inputs.length > 256) throw new ImageWorkshopError('Atlas packing is bounded to 256 input images.');
    const inputs = options.inputs.map((path) => resolvedInput(path));
    const output = resolvedInput(options.output, 'Output');
    if (!/\.png$/i.test(output)) throw new ImageWorkshopError('Atlas output must be a PNG so RPG Maker MV retains alpha fidelity.');
    const maxSize = numberOption(options.maxSize, 'Maximum atlas size');
    if (maxSize === undefined) throw new ImageWorkshopError('Atlas packing requires a maximum size.');
    const padding = numberOption(options.padding ?? 0, 'Padding', 0)!;
    const extrusion = numberOption(options.extrusion ?? 0, 'Extrusion', 0)!;
    if (padding > 64 || extrusion > 64 || maxSize! > 8192) throw new ImageWorkshopError('Atlas padding, extrusion, or maximum size exceeds the bounded resource policy.');
    const inputInfo = await Promise.all(inputs.map((path) => this.inspect(path)));
    const names = inputs.map((path) => basename(path));
    if (new Set(names).size !== names.length) throw new ImageWorkshopError('Atlas inputs must have unique file names so the JSON manifest can identify every source exactly once.');
    const atlasJson = join(dirname(output), `${basename(output, extname(output))}.json`);
    const manifestPath = manifestPathForOutput(output);
    await assertOutputPaths([output, atlasJson, manifestPath], inputs);
    const created = [output, atlasJson, manifestPath];
    try {
      const helperRequire = createRequire(join(this.toolchain.helperRoot, 'package.json'));
      type PackAsync = (files: Array<{ path: string; contents: Buffer }>, config: Record<string, unknown>) => Promise<Array<{ name: string; buffer: Buffer }>>;
      const moduleValue = helperRequire(FREE_TEX_PACKAGE) as { packAsync?: PackAsync; default?: { packAsync?: PackAsync } };
      const packAsync = moduleValue.packAsync ?? moduleValue.default?.packAsync;
      if (!packAsync) throw new ImageWorkshopError(`Pinned ${FREE_TEX_PACKAGE}@${FREE_TEX_PACKER_VERSION} does not expose packAsync.`);
      const files = await packAsync(await Promise.all(inputs.map(async (path) => ({ path: basename(path), contents: await readFile(path) }))), {
        textureName: basename(output, extname(output)),
        width: maxSize,
        height: maxSize,
        padding,
        extrude: extrusion,
        allowRotation: false,
        allowTrim: options.fixedGrid ? false : true,
        detectIdentical: false,
        removeFileExtension: false,
        prependFolderName: false,
        scaleMethod: 'NEAREST_NEIGHBOR',
        exporter: 'JsonHash',
        textureFormat: 'png'
      });
      const pngFile = files.find((file) => /\.png$/i.test(file.name));
      const jsonFile = files.find((file) => /\.json$/i.test(file.name));
      if (!pngFile || !jsonFile) throw new ImageWorkshopError('Atlas helper did not return both PNG and JSON outputs.');
      await writeFile(output, pngFile.buffer);
      await writeFile(atlasJson, jsonFile.buffer);
      const atlasInfo = await this.inspect(output);
      if (atlasInfo.width > maxSize! || atlasInfo.height > maxSize!) throw new ImageWorkshopError(`Atlas output ${atlasInfo.width}x${atlasInfo.height} exceeds the ${maxSize}x${maxSize} limit.`);
      const parsed = asObject(JSON.parse(jsonFile.buffer.toString('utf8')));
      const frameObject = asObject(parsed?.frames);
      if (!frameObject) throw new ImageWorkshopError('Atlas helper returned JSON without a frames object.');
      const frameRecords: Array<Record<string, unknown>> = [];
      if (Object.keys(frameObject).length !== names.length) throw new ImageWorkshopError('Atlas JSON contains a frame count different from the requested input count.');
      for (const name of names) {
        const record = asObject(frameObject[name]);
        const frame = asObject(record?.frame);
        if (!record || !frame) throw new ImageWorkshopError(`Atlas JSON is missing exactly one frame for ${name}.`);
        const x = Number(frame.x);
        const y = Number(frame.y);
        const width = Number(frame.w);
        const height = Number(frame.h);
        if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > atlasInfo.width || y + height > atlasInfo.height) throw new ImageWorkshopError(`Atlas frame ${name} is outside the output bounds.`);
        if (options.fixedGrid && (record.rotated === true || record.trimmed === true)) throw new ImageWorkshopError(`Fixed-grid atlas frame ${name} was rotated or trimmed.`);
        frameRecords.push({ name, x, y, width, height, rotated: record.rotated === true, trimmed: record.trimmed === true });
      }
      const manifest: ImageOperationManifest = {
        schemaVersion: 1,
        operation: 'atlas-pack',
        toolchain: toolchainSummary(this.toolchain),
        inputs: inputInfo,
        outputs: [{ ...atlasInfo }],
        options: { maxSize, padding, extrusion, fixedGrid: options.fixedGrid ?? false, allowRotation: false, allowTrim: options.fixedGrid ? false : true, sourceOverwrite: false },
        fidelity: { dimensions: true, alphaPreserved: atlasInfo.hasAlpha, sourceNamesExactlyOnce: frameRecords.length === names.length, frames: frameRecords },
        lossless: true
      };
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      return { operation: 'atlas-pack', outputPaths: [output, atlasJson], manifestPath, manifest };
    } catch (error) {
      await removeCreated(created);
      if (error instanceof ImageWorkshopError) throw error;
      throw new ImageWorkshopError(`Atlas packing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async optimizePng(options: OptimizePngOptions): Promise<ImageOperationResult> {
    const input = resolvedInput(options.input);
    const output = resolvedInput(options.output, 'Output');
    if (!/\.png$/i.test(input) || !/\.png$/i.test(output)) throw new ImageWorkshopError('Explicit PNG optimization requires PNG input and output paths.');
    if (!this.toolchain.oxipng || !this.toolchain.oxipngVersion) throw new ImageWorkshopError(`oxipng ${OXIPNG_VERSION} is optional and not installed. Configure it explicitly before requesting release optimization.`);
    const inputInfo = await this.inspect(input);
    const sourcePixels = await this.pixels(input);
    const level = numberOption(options.level ?? 4, 'oxipng optimization level', 0)!;
    if (level > 6) throw new ImageWorkshopError('oxipng optimization level must be between 0 and 6.');
    const manifestPath = manifestPathForOutput(output);
    await assertOutputPaths([output, manifestPath], [input]);
    const created = [output, manifestPath];
    try {
      const runner = this.dependencies.commandRunner ?? runCommand;
      const env = this.dependencies.env ?? process.env;
      const args = ['-o', String(level), '--strip', 'safe', '--out', output, input];
      let result;
      try {
        result = await runner(this.toolchain.oxipng, args, {
          env: withoutCredentials(env),
          platform: this.dependencies.platform ?? process.platform,
          timeoutMs: this.dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS
        });
      } catch (error) {
        throw new ImageWorkshopError(`oxipng optimization could not start: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (result.exitCode !== 0) throw new ImageWorkshopError(`oxipng optimization failed: ${commandFailure(this.toolchain.oxipng, args, result, env).message}`);
      const outputInfo = await this.inspect(output);
      if (outputInfo.width !== inputInfo.width || outputInfo.height !== inputInfo.height || outputInfo.hasAlpha !== inputInfo.hasAlpha) throw new ImageWorkshopError('oxipng changed image dimensions or alpha mode.');
      assertSameGrid(await this.pixels(output), sourcePixels, 'oxipng decoded-pixel');
      return await this.finish('optimize-png', [inputInfo], [output], { level, optimizer: 'oxipng', explicit: true, sourceOverwrite: false }, { dimensions: true, alphaPreserved: true, decodedPixelsEqual: true }, true);
    } catch (error) {
      await removeCreated(created);
      throw error;
    }
  }
}

export function createImageWorkshop(toolchain: ImageToolchain, dependencies: ImageWorkshopDependencies = {}): ImageWorkshop {
  return new ImageWorkshop(toolchain, dependencies);
}

export function defaultImageToolchainRoot(dshHome?: string): string {
  return resolve(dshHome ?? resolveHarnessPaths().dshHome, DEFAULT_TOOLCHAIN_RELATIVE);
}

export function toolchainManifestForRoot(root: string): string {
  return join(resolve(root), IMAGE_MANIFEST_NAME);
}
