import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

import {
  ASSET_WORKSHOP_PRESET_ID,
  FREE_TEX_PACKER_VERSION,
  IMAGE_MAGICK_VERSION,
  IMAGE_WORKSHOP_MANIFEST_FORMAT,
  OXIPNG_VERSION,
  ImageWorkshopError,
  detectOptionalEnhancements,
  ensureImageHelperRuntime,
  prepareImageToolchain,
  resolveImageToolchain,
  toolchainManifestForRoot,
  toolchainSummary,
  verifyImageToolchain,
  writeImageToolchainManifest,
  type ImageArchiveDownloader,
  type ImageArchiveExtractor,
  type ImageArchiveOperationOptions,
  type ImageHelperRuntimeOptions,
  type ImageToolRenamePath,
  type ImageToolchain,
  type ImageToolchainManifest,
  type ImageToolchainOptions,
  type ImageToolchainPreparation,
  type ImageToolchainPreparationOptions,
  type NativeToolManifest,
  type OptionalEnhancements
} from './image-toolchain';
import { resolveHarnessPaths, type PathOptions } from './config';
import { commandFailure, runCommand, withoutCredentials, type CommandRunner } from './process';

export {
  ASSET_WORKSHOP_PRESET_ID,
  FREE_TEX_PACKER_VERSION,
  IMAGE_MAGICK_VERSION,
  IMAGE_WORKSHOP_MANIFEST_FORMAT,
  OXIPNG_VERSION,
  ImageWorkshopError,
  detectOptionalEnhancements,
  ensureImageHelperRuntime,
  prepareImageToolchain,
  resolveImageToolchain,
  toolchainManifestForRoot,
  toolchainSummary,
  verifyImageToolchain,
  writeImageToolchainManifest
};
export type {
  ImageArchiveDownloader,
  ImageArchiveExtractor,
  ImageArchiveOperationOptions,
  ImageHelperRuntimeOptions,
  ImageToolRenamePath,
  ImageToolchain,
  ImageToolchainManifest,
  ImageToolchainOptions,
  ImageToolchainPreparation,
  ImageToolchainPreparationOptions,
  NativeToolManifest,
  OptionalEnhancements
};

const DEFAULT_MAX_PIXELS = 16_777_216;
const DEFAULT_TIMEOUT_MS = 120_000;
const FREE_TEX_PACKAGE = 'free-tex-packer-core';
const RESOURCE_ARGS = [
  '-limit', 'memory', '256MiB',
  '-limit', 'map', '512MiB',
  '-limit', 'area', '128MP',
  '-limit', 'time', '120'
];
const PNG_DETERMINISM_ARGS = ['-define', 'png:exclude-chunk=date,time'];

export interface AtlasPackFile {
  name: string;
  buffer: Buffer;
}

export type AtlasPackAsync = (files: Array<{ path: string; contents: Buffer }>, config: Record<string, unknown>) => Promise<AtlasPackFile[]>;

export interface ImageWorkshopDependencies {
  commandRunner?: CommandRunner;
  platform?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxPixels?: number;
  /** Test-owned seam; production resolves the pinned helper from helperRoot. */
  atlasPacker?: AtlasPackAsync;
}

export interface ImageMetadata {
  kind?: 'image';
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

export interface FileArtifactMetadata {
  kind: 'json';
  path: string;
  format: 'JSON';
  bytes: number;
  sha256: string;
}

export type ImageArtifact = ImageMetadata | FileArtifactMetadata;

export interface ImageOperationResult {
  operation: string;
  outputPaths: string[];
  manifestPath: string;
  manifest: ImageOperationManifest;
}

export interface ImageOperationManifest {
  schemaVersion: 2;
  operation: string;
  toolchain: ReturnType<typeof toolchainSummary>;
  inputs: ImageMetadata[];
  outputs: ImageArtifact[];
  options: Record<string, unknown>;
  fidelity: Record<string, unknown>;
  verificationLevel: 'decoded-pixels' | 'representative-pixels' | 'metadata-only';
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

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
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

function manifestPathForOutput(output: string): string {
  return `${output}.manifest.json`;
}

function atlasOutputPaths(outputDir: string): { outputDir: string; textureName: string; png: string; json: string; manifest: string } {
  const directory = resolve(outputDir);
  const textureName = basename(directory).replace(/\.png$/i, '') || 'atlas';
  return {
    outputDir: directory,
    textureName,
    png: join(directory, `${textureName}.png`),
    json: join(directory, `${textureName}.json`),
    manifest: join(directory, 'manifest.json')
  };
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(parent: string, child: string): boolean {
  const remainder = relative(resolve(parent), resolve(child));
  return remainder === '' || (!remainder.startsWith(`..${sep}`) && remainder !== '..');
}

async function canonicalParent(path: string, label: string): Promise<string> {
  const parent = resolve(dirname(path));
  await mkdir(parent, { recursive: true });
  let canonical: string;
  try {
    canonical = await realpath(parent);
  } catch (error) {
    throw new ImageWorkshopError(`${label} parent could not be canonicalized: ${error instanceof Error ? error.message : String(error)}`);
  }
  // macOS exposes /var as a system alias for /private/var. Treat that fixed
  // system prefix as the approved temp parent, but reject user-created links
  // below it (and reject links everywhere else).
  const lexicalTemp = resolve(tmpdir());
  const canonicalTemp = await realpath(lexicalTemp);
  const expectedTempPath = pathWithin(lexicalTemp, parent)
    ? resolve(canonicalTemp, relative(lexicalTemp, parent))
    : parent;
  if (!samePath(expectedTempPath, canonical)) throw new ImageWorkshopError(`${label} parent resolves through a symlink or junction; refusing a path escape: ${parent}`);
  return canonical;
}

async function assertSafeInput(path: string): Promise<{ path: string; realPath: string }> {
  const normalized = resolve(path);
  let info;
  try {
    info = await lstat(normalized);
  } catch {
    throw new ImageWorkshopError(`Input image does not exist or is not a regular file: ${normalized}`);
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new ImageWorkshopError(`Input image must be a regular non-symlink file: ${normalized}`);
  await canonicalParent(normalized, 'Input');
  const realPath = await realpath(normalized);
  return { path: normalized, realPath };
}

async function assertOutputDoesNotExist(path: string, inputs: string[], label = 'Output'): Promise<void> {
  const normalized = resolve(path);
  await canonicalParent(normalized, label);
  const sourceRealPaths = await Promise.all(inputs.map(async (input) => (await assertSafeInput(input)).realPath));
  if (inputs.some((input) => samePath(resolve(input), normalized)) || sourceRealPaths.some((source) => samePath(source, normalized))) throw new ImageWorkshopError(`Refusing to overwrite source image: ${normalized}`);
  let info;
  try {
    info = await lstat(normalized);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') info = undefined;
    else throw new ImageWorkshopError(`${label} could not be checked: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (info) throw new ImageWorkshopError(`Refusing to overwrite existing output: ${normalized}`);
}

interface FileOperation {
  finalParent: string;
  tempDir: string;
  finalPaths: string[];
}

async function beginFileOperation(outputs: string[], inputs: string[]): Promise<FileOperation> {
  const finalPaths = outputs.map((path) => resolve(path));
  if (new Set(finalPaths.map((path) => process.platform === 'win32' ? path.toLowerCase() : path)).size !== finalPaths.length) {
    throw new ImageWorkshopError('Output paths collide with one another.');
  }
  const parents = await Promise.all(finalPaths.map((path) => canonicalParent(path, 'Output')));
  if (parents.some((parent) => !samePath(parent, parents[0]))) throw new ImageWorkshopError('One image operation must use one output directory.');
  for (const path of finalPaths) await assertOutputDoesNotExist(path, inputs, 'Output');
  const tempDir = await mkdtemp(join(parents[0], `.dsh-image-operation-${randomUUID()}-`));
  const tempReal = await realpath(tempDir);
  if (!samePath(tempDir, tempReal)) {
    await rm(tempDir, { recursive: true, force: true });
    throw new ImageWorkshopError('Operation temporary directory resolves through a symlink or junction.');
  }
  return { finalParent: parents[0], tempDir, finalPaths };
}

async function beginDirectoryOperation(outputDirInput: string, inputs: string[]): Promise<FileOperation & { outputDir: string }> {
  const outputDir = resolve(outputDirInput);
  const parent = await canonicalParent(outputDir, 'Output directory');
  let existing;
  try {
    existing = await lstat(outputDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (existing) throw new ImageWorkshopError(`Refusing to overwrite existing output directory: ${outputDir}`);
  const sourceRealPaths = await Promise.all(inputs.map(async (input) => (await assertSafeInput(input)).realPath));
  if (sourceRealPaths.some((source) => samePath(source, outputDir))) throw new ImageWorkshopError(`Output directory cannot be the source path: ${outputDir}`);
  const tempDir = await mkdtemp(join(parent, `.${basename(outputDir)}.dsh-staging-${randomUUID()}-`));
  const tempReal = await realpath(tempDir);
  if (!samePath(tempDir, tempReal)) {
    await rm(tempDir, { recursive: true, force: true });
    throw new ImageWorkshopError('Operation temporary directory resolves through a symlink or junction.');
  }
  return { finalParent: parent, tempDir, finalPaths: [], outputDir };
}

async function assertOperationParent(operation: FileOperation, label: string): Promise<void> {
  const current = await realpath(operation.finalParent);
  if (!samePath(current, operation.finalParent)) throw new ImageWorkshopError(`${label} parent changed through a symlink or junction during the operation.`);
}

async function assertStageFile(path: string): Promise<void> {
  const info = await lstat(path).catch(() => undefined);
  if (!info?.isFile() || info.isSymbolicLink()) throw new ImageWorkshopError(`Operation did not produce a regular staged file: ${path}`);
}

async function commitFiles(operation: FileOperation, entries: Array<{ finalPath: string; stagedPath: string }>): Promise<void> {
  try {
    await assertOperationParent(operation, 'Output');
    for (const entry of entries) {
      await assertStageFile(entry.stagedPath);
      await assertOutputDoesNotExist(entry.finalPath, [], 'Output');
    }
    // Hard-linking a verified staged file is an exclusive, no-clobber commit.
    // It avoids a pathExists-then-write race without introducing a lock layer.
    for (const entry of entries) {
      try {
        await link(entry.stagedPath, entry.finalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new ImageWorkshopError(`Output appeared during commit; refusing to overwrite the racing path: ${entry.finalPath}`);
        throw error;
      }
      await unlink(entry.stagedPath);
    }
    await rm(operation.tempDir, { recursive: true, force: true });
  } catch (error) {
    await rm(operation.tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function commitDirectory(operation: FileOperation & { outputDir: string }): Promise<void> {
  try {
    await assertOperationParent(operation, 'Output directory');
    let existing;
    try {
      existing = await lstat(operation.outputDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (existing) throw new ImageWorkshopError(`Output directory appeared during commit; refusing to overwrite it: ${operation.outputDir}`);
    try {
      await rename(operation.tempDir, operation.outputDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST' || (error as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
        throw new ImageWorkshopError(`Output directory appeared during commit; refusing to overwrite it: ${operation.outputDir}`);
      }
      throw error;
    }
  } catch (error) {
    await rm(operation.tempDir, { recursive: true, force: true });
    throw error;
  }
}

async function removeOperation(operation: FileOperation): Promise<void> {
  await rm(operation.tempDir, { recursive: true, force: true }).catch(() => undefined);
}

interface PixelGrid {
  width: number;
  height: number;
  pixels: string[];
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
  for (let y = 0; y < grid.height; y += 1) for (let x = 0; x < grid.width; x += 1) {
    if (alphaValue(grid.pixels[y * grid.width + x]) > 0) {
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? undefined : { left, top, right, bottom };
}

function cropGrid(source: PixelGrid, left: number, top: number, width: number, height: number): PixelGrid {
  const pixels: string[] = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) pixels.push(source.pixels[(top + y) * source.width + left + x]);
  return { width, height, pixels };
}

function placeGrid(source: PixelGrid, width: number, height: number, gravity: NonNullable<TrimPadOptions['gravity']>): PixelGrid {
  const pixels = new Array<string>(width * height).fill('00000000');
  const horizontalCenter = Math.floor((width - source.width) / 2);
  const verticalCenter = Math.floor((height - source.height) / 2);
  const left = gravity.endsWith('east') || gravity === 'east' ? width - source.width : gravity.endsWith('west') || gravity === 'west' ? 0 : horizontalCenter;
  const top = gravity.startsWith('south') || gravity === 'south' ? height - source.height : gravity.startsWith('north') || gravity === 'north' ? 0 : verticalCenter;
  for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) pixels[(top + y) * width + left + x] = source.pixels[y * source.width + x];
  return { width, height, pixels };
}

function assertSameGrid(actual: PixelGrid, expected: PixelGrid, label: string): void {
  if (actual.width !== expected.width || actual.height !== expected.height) throw new ImageWorkshopError(`${label} fidelity check failed: dimensions differ.`);
  for (let index = 0; index < actual.pixels.length; index += 1) if (actual.pixels[index] !== expected.pixels[index]) throw new ImageWorkshopError(`${label} fidelity check failed at pixel ${index}.`);
}

function resizeGrid(source: PixelGrid, scale: number): PixelGrid {
  const pixels: string[] = [];
  for (let y = 0; y < source.height; y += 1) for (let sy = 0; sy < scale; sy += 1) for (let x = 0; x < source.width; x += 1) for (let sx = 0; sx < scale; sx += 1) pixels.push(source.pixels[y * source.width + x]);
  return { width: source.width * scale, height: source.height * scale, pixels };
}

function assembleGrid(inputs: PixelGrid[], columns: number): PixelGrid {
  const cellWidth = inputs[0].width;
  const cellHeight = inputs[0].height;
  const rows = inputs.length / columns;
  const pixels: string[] = [];
  for (let row = 0; row < rows; row += 1) for (let y = 0; y < cellHeight; y += 1) for (let column = 0; column < columns; column += 1) {
    const source = inputs[row * columns + column];
    pixels.push(...source.pixels.slice(y * cellWidth, (y + 1) * cellWidth));
  }
  return { width: cellWidth * columns, height: cellHeight * rows, pixels };
}

function fixedGridFrames(width: number, height: number, cellWidth: number, cellHeight: number): Array<{ index: number; x: number; y: number; width: number; height: number }> {
  const frames: Array<{ index: number; x: number; y: number; width: number; height: number }> = [];
  let index = 0;
  for (let y = 0; y < height; y += cellHeight) for (let x = 0; x < width; x += cellWidth) frames.push({ index: index++, x, y, width: cellWidth, height: cellHeight });
  return frames;
}

async function inspectWith(toolchain: ImageToolchain, input: string, dependencies: ImageWorkshopDependencies): Promise<ImageMetadata> {
  const safe = await assertSafeInput(input);
  const runner = dependencies.commandRunner ?? runCommand;
  const env = dependencies.env ?? process.env;
  const path = safe.path;
  const args = [...RESOURCE_ARGS, path, '-format', '%w|%h|%m|%[channels]|%[opaque]', 'info:'];
  let result;
  try {
    result = await runner(toolchain.imageMagick, args, {
      env: withoutCredentials(env),
      platform: dependencies.platform ?? process.platform,
      timeoutMs: dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS
    });
  } catch (error) {
    throw new ImageWorkshopError(`ImageMagick inspect failed for ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (result.exitCode !== 0) throw new ImageWorkshopError(`ImageMagick inspect failed: ${commandFailure(toolchain.imageMagick, args, result, env).message}`);
  const info = parseInfo(result.stdout, path);
  const maxPixels = dependencies.maxPixels ?? DEFAULT_MAX_PIXELS;
  if (info.width * info.height > maxPixels) throw new ImageWorkshopError(`Image ${path} is ${info.width}x${info.height}; resource limit is ${maxPixels} pixels.`);
  const file = await stat(path);
  return {
    kind: 'image',
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

function finalImageMetadata(metadata: ImageMetadata, path: string): ImageMetadata {
  return { ...metadata, path, kind: 'image' };
}

async function jsonMetadata(path: string, finalPath: string): Promise<FileArtifactMetadata> {
  const file = await stat(path);
  return { kind: 'json', path: finalPath, format: 'JSON', bytes: file.size, sha256: await sha256File(path) };
}

async function writeManifestInStage(path: string, manifest: ImageOperationManifest): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
}

async function readJsonFile(path: string): Promise<JsonObject> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new ImageWorkshopError(`Atlas JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const object = asObject(value);
  if (!object) throw new ImageWorkshopError('Atlas JSON must be an object.');
  return object;
}

export class ImageWorkshop {
  constructor(
    readonly toolchain: ImageToolchain,
    readonly dependencies: ImageWorkshopDependencies = {}
  ) {}

  async inspect(input: string): Promise<ImageMetadata> {
    return inspectWith(this.toolchain, resolvedInput(input), this.dependencies);
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
    operation: FileOperation,
    name: string,
    inputs: ImageMetadata[],
    stagedOutputs: Array<{ finalPath: string; stagedPath: string; metadata: ImageArtifact }>,
    options: Record<string, unknown>,
    fidelity: Record<string, unknown>,
    verificationLevel: ImageOperationManifest['verificationLevel'],
    lossless: boolean
  ): Promise<ImageOperationResult> {
    const manifestPath = manifestPathForOutput(stagedOutputs[0].finalPath);
    const manifestStage = join(operation.tempDir, basename(manifestPath));
    const manifest: ImageOperationManifest = {
      schemaVersion: 2,
      operation: name,
      toolchain: toolchainSummary(this.toolchain),
      inputs,
      outputs: stagedOutputs.map((entry) => entry.metadata),
      options,
      fidelity,
      verificationLevel,
      lossless
    };
    await writeManifestInStage(manifestStage, manifest);
    await commitFiles(operation, [...stagedOutputs.map((entry) => ({ finalPath: entry.finalPath, stagedPath: entry.stagedPath })), { finalPath: manifestPath, stagedPath: manifestStage }]);
    return { operation: name, outputPaths: stagedOutputs.map((entry) => entry.finalPath), manifestPath, manifest };
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
      if (!Number.isInteger(widthScale) || widthScale !== heightScale || widthScale < 1) throw new ImageWorkshopError(`Pixel-safe resize requires one integer scale; requested ${width}x${height} from ${inputInfo.width}x${inputInfo.height}.`);
      scale = widthScale;
    }
    const expectedWidth = inputInfo.width * scale;
    const expectedHeight = inputInfo.height * scale;
    const maxPixels = this.dependencies.maxPixels ?? DEFAULT_MAX_PIXELS;
    if (expectedWidth * expectedHeight > maxPixels) throw new ImageWorkshopError(`Pixel resize output would exceed the ${maxPixels}-pixel resource limit.`);
    if ((options.width !== undefined && options.width !== expectedWidth) || (options.height !== undefined && options.height !== expectedHeight)) throw new ImageWorkshopError('Pixel resize width/height do not match the integer scale.');
    const operation = await beginFileOperation([output, manifestPathForOutput(output)], [input]);
    const staged = join(operation.tempDir, basename(output));
    try {
      await this.magick('pixel resize', [input, ...alphaOption(inputInfo.hasAlpha), '-filter', 'point', '-resize', `${expectedWidth}x${expectedHeight}!`, ...PNG_DETERMINISM_ARGS, staged]);
      const outputInfo = await this.inspect(staged);
      if (outputInfo.width !== expectedWidth || outputInfo.height !== expectedHeight) throw new ImageWorkshopError('Pixel resize output dimensions did not match the requested integer scale.');
      if (outputInfo.hasAlpha !== inputInfo.hasAlpha) throw new ImageWorkshopError('Pixel resize changed the source alpha channel.');
      assertSameGrid(await this.pixels(staged), resizeGrid(sourceGrid, scale), 'Pixel resize');
      return await this.finish(operation, 'resize-pixel', [inputInfo], [{ finalPath: output, stagedPath: staged, metadata: finalImageMetadata(outputInfo, output) }], { scale, filter: 'point', sourceOverwrite: false }, { dimensions: true, alphaPreserved: true, nearestNeighbor: true, pixelsMatch: true }, 'decoded-pixels', true);
    } catch (error) {
      await removeOperation(operation);
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
    const bounds = trim && inputInfo.hasAlpha ? alphaBounds(sourceGrid) : undefined;
    const effectiveTrim = trim && inputInfo.hasAlpha && bounds !== undefined;
    const trimmedWidth = bounds ? bounds.right - bounds.left + 1 : inputInfo.width;
    const trimmedHeight = bounds ? bounds.bottom - bounds.top + 1 : inputInfo.height;
    if (width !== undefined && (width < trimmedWidth || height! < trimmedHeight)) throw new ImageWorkshopError(`Transparent padding canvas ${width}x${height} is smaller than the ${trimmedWidth}x${trimmedHeight} trimmed image.`);
    const maxPixels = this.dependencies.maxPixels ?? DEFAULT_MAX_PIXELS;
    if (width !== undefined && width * height! > maxPixels) throw new ImageWorkshopError(`Trim/pad output would exceed the ${maxPixels}-pixel resource limit.`);
    const operation = await beginFileOperation([output, manifestPathForOutput(output)], [input]);
    const staged = join(operation.tempDir, basename(output));
    const outputHasAlpha = width !== undefined || inputInfo.hasAlpha;
    try {
      const args = [input, ...alphaOption(outputHasAlpha)];
      if (effectiveTrim) args.push('-trim', '+repage');
      if (width !== undefined) args.push('-background', 'none', '-gravity', options.gravity ?? 'center', '-extent', `${width}x${height}`);
      args.push(...PNG_DETERMINISM_ARGS, staged);
      await this.magick('trim/pad', args);
      const outputInfo = await this.inspect(staged);
      if (width !== undefined && (outputInfo.width !== width || outputInfo.height !== height)) throw new ImageWorkshopError('Trim/pad output dimensions did not match the requested transparent canvas.');
      if (outputInfo.hasAlpha !== outputHasAlpha) throw new ImageWorkshopError('Trim/pad output alpha semantics did not match the requested operation.');
      const expectedTrimmed = bounds ? cropGrid(sourceGrid, bounds.left, bounds.top, trimmedWidth, trimmedHeight) : sourceGrid;
      const expectedGrid = width !== undefined ? placeGrid(expectedTrimmed, width, height!, options.gravity ?? 'center') : expectedTrimmed;
      assertSameGrid(await this.pixels(staged), expectedGrid, 'Trim/pad');
      const transparentPadding = width !== undefined && (outputHasAlpha && (width > trimmedWidth || height! > trimmedHeight));
      return await this.finish(operation, 'trim-pad', [inputInfo], [{ finalPath: output, stagedPath: staged, metadata: finalImageMetadata(outputInfo, output) }], { trim, canvas: width !== undefined ? { width, height } : undefined, gravity: options.gravity ?? 'center', sourceOverwrite: false, fullyTransparentTrim: trim && inputInfo.hasAlpha && bounds === undefined ? 'preserve-source-canvas' : undefined }, { dimensions: true, alphaPreserved: true, alphaChannelAddedForPadding: !inputInfo.hasAlpha && width !== undefined, sourceAlphaBounds: bounds ?? null, trimmedSize: { width: trimmedWidth, height: trimmedHeight }, transparentPadding }, 'decoded-pixels', true);
    } catch (error) {
      await removeOperation(operation);
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
    if (inputInfo.width % cellWidth !== 0 || inputInfo.height % cellHeight !== 0) throw new ImageWorkshopError(`Sheet dimensions ${inputInfo.width}x${inputInfo.height} are not divisible by cell ${cellWidth}x${cellHeight}.`);
    const frames = fixedGridFrames(inputInfo.width, inputInfo.height, cellWidth, cellHeight);
    if (frames.length > 4096) throw new ImageWorkshopError('Sheet slicing is bounded to 4096 frames.');
    const maxPixels = this.dependencies.maxPixels ?? DEFAULT_MAX_PIXELS;
    if (inputInfo.width * inputInfo.height > maxPixels) throw new ImageWorkshopError(`Sheet slicing input exceeds the ${maxPixels}-pixel resource limit.`);
    const operation = await beginDirectoryOperation(outputDir, [input]);
    const outputs = frames.map((frame) => join(outputDir, `frame-${String(frame.index).padStart(4, '0')}.png`));
    const stagedOutputs = frames.map((frame) => join(operation.tempDir, `frame-${String(frame.index).padStart(4, '0')}.png`));
    const manifestPath = join(outputDir, 'manifest.json');
    try {
      await this.magick('sheet slicing', [input, ...alphaOption(inputInfo.hasAlpha), '-crop', `${cellWidth}x${cellHeight}`, '+repage', ...PNG_DETERMINISM_ARGS, join(operation.tempDir, 'frame-%04d.png')]);
      const sourceGrid = await this.pixels(input);
      const metadata: ImageMetadata[] = [];
      for (const frame of frames) {
        const stagedPath = stagedOutputs[frame.index];
        const frameInfo = await this.inspect(stagedPath);
        if (frameInfo.width !== cellWidth || frameInfo.height !== cellHeight || frameInfo.hasAlpha !== inputInfo.hasAlpha) throw new ImageWorkshopError(`Sheet frame ${frame.index} failed dimensions or alpha verification.`);
        assertSameGrid(await this.pixels(stagedPath), cropGrid(sourceGrid, frame.x, frame.y, frame.width, frame.height), `Sheet frame ${frame.index}`);
        metadata.push(finalImageMetadata(frameInfo, outputs[frame.index]));
      }
      const manifest: ImageOperationManifest = {
        schemaVersion: 2,
        operation: 'sheet-slice',
        toolchain: toolchainSummary(this.toolchain),
        inputs: [inputInfo],
        outputs: metadata,
        options: { cellWidth, cellHeight, order: 'row-major', sourceOverwrite: false },
        fidelity: { dimensions: true, alphaPreserved: true, frames: frames.map((frame) => ({ index: frame.index, x: frame.x, y: frame.y, width: frame.width, height: frame.height })), pixelsMatch: true },
        verificationLevel: 'decoded-pixels',
        lossless: true
      };
      await writeManifestInStage(join(operation.tempDir, 'manifest.json'), manifest);
      await commitDirectory(operation);
      return { operation: 'sheet-slice', outputPaths: outputs, manifestPath, manifest };
    } catch (error) {
      await removeOperation(operation);
      throw error;
    }
  }

  async sheetAssemble(options: SheetAssembleOptions): Promise<ImageOperationResult> {
    if (options.inputs.length === 0) throw new ImageWorkshopError('Sheet assembly requires at least one input.');
    if (options.inputs.length > 256) throw new ImageWorkshopError('Sheet assembly is bounded to 256 input cells.');
    const inputs = options.inputs.map((path) => resolvedInput(path));
    const output = resolvedInput(options.output, 'Output');
    const columns = numberOption(options.columns, 'Columns');
    if (columns === undefined || inputs.length % columns !== 0) throw new ImageWorkshopError(`Sheet assembly requires an input count divisible by columns (${columns ?? 0}).`);
    const inputInfo = await Promise.all(inputs.map((path) => this.inspect(path)));
    const aggregate = inputInfo.reduce((sum, info) => sum + info.width * info.height, 0);
    const maxPixels = this.dependencies.maxPixels ?? DEFAULT_MAX_PIXELS;
    if (aggregate > maxPixels) throw new ImageWorkshopError(`Sheet assembly inputs exceed the aggregate ${maxPixels}-pixel resource limit.`);
    const assembledWidth = inputInfo[0].width * columns;
    const assembledHeight = inputInfo[0].height * (inputs.length / columns);
    if (assembledWidth * assembledHeight > maxPixels) throw new ImageWorkshopError(`Sheet assembly output would exceed the ${maxPixels}-pixel resource limit.`);
    if (inputInfo.some((info) => info.width !== inputInfo[0].width || info.height !== inputInfo[0].height || info.hasAlpha !== inputInfo[0].hasAlpha)) throw new ImageWorkshopError('Sheet assembly inputs must have matching dimensions and alpha mode.');
    const operation = await beginFileOperation([output, manifestPathForOutput(output)], inputs);
    const staged = join(operation.tempDir, basename(output));
    const rows = join(operation.tempDir, 'rows');
    await mkdir(rows, { recursive: true });
    try {
      const rowPaths: string[] = [];
      for (let row = 0; row < inputs.length / columns; row += 1) {
        const rowPath = join(rows, `row-${String(row).padStart(4, '0')}.png`);
        rowPaths.push(rowPath);
        await this.magick('sheet row assembly', [...inputs.slice(row * columns, (row + 1) * columns), ...alphaOption(inputInfo[0].hasAlpha), '+append', ...PNG_DETERMINISM_ARGS, rowPath]);
      }
      await this.magick('sheet assembly', [...rowPaths, ...alphaOption(inputInfo[0].hasAlpha), '-append', ...PNG_DETERMINISM_ARGS, staged]);
      const outputInfo = await this.inspect(staged);
      const sourceGrids = await Promise.all(inputs.map((path) => this.pixels(path)));
      assertSameGrid(await this.pixels(staged), assembleGrid(sourceGrids, columns), 'Sheet assembly');
      return await this.finish(operation, 'sheet-assemble', inputInfo, [{ finalPath: output, stagedPath: staged, metadata: finalImageMetadata(outputInfo, output) }], { columns, order: 'row-major', sourceOverwrite: false }, { dimensions: true, alphaPreserved: true, pixelsMatch: true }, 'decoded-pixels', true);
    } catch (error) {
      await removeOperation(operation);
      throw error;
    }
  }

  async atlasPack(options: AtlasPackOptions): Promise<ImageOperationResult> {
    if (options.inputs.length === 0) throw new ImageWorkshopError('Atlas packing requires at least one input.');
    if (options.inputs.length > 256) throw new ImageWorkshopError('Atlas packing is bounded to 256 input images.');
    const inputs = options.inputs.map((path) => resolvedInput(path));
    const outputPaths = atlasOutputPaths(options.output);
    const maxSize = numberOption(options.maxSize, 'Maximum atlas size');
    if (maxSize === undefined) throw new ImageWorkshopError('Atlas packing requires a maximum size.');
    const padding = numberOption(options.padding ?? 0, 'Padding', 0)!;
    const extrusion = numberOption(options.extrusion ?? 0, 'Extrusion', 0)!;
    const maxPixels = this.dependencies.maxPixels ?? DEFAULT_MAX_PIXELS;
    if (padding > 64 || extrusion > 64 || maxSize > 8192) throw new ImageWorkshopError('Atlas padding, extrusion, or maximum size exceeds the bounded resource policy.');
    if (maxSize * maxSize > maxPixels) throw new ImageWorkshopError(`Atlas maximum output ${maxSize}x${maxSize} exceeds the ${maxPixels}-pixel resource limit.`);
    const inputInfo = await Promise.all(inputs.map((path) => this.inspect(path)));
    const aggregateInputPixels = inputInfo.reduce((sum, info) => sum + info.width * info.height, 0);
    if (aggregateInputPixels > maxPixels) throw new ImageWorkshopError(`Atlas inputs exceed the aggregate ${maxPixels}-pixel resource limit.`);
    const sourceGrids = await Promise.all(inputs.map((path) => this.pixels(path)));
    const names = inputs.map((path) => basename(path));
    const nameKeys = names.map((name) => this.dependencies.platform === 'win32' ? name.toLowerCase() : name);
    if (new Set(nameKeys).size !== names.length) throw new ImageWorkshopError('Atlas inputs must have unique file names so the JSON manifest can identify every source exactly once.');
    const operation = await beginDirectoryOperation(outputPaths.outputDir, inputs);
    const stagedPng = join(operation.tempDir, basename(outputPaths.png));
    const stagedJson = join(operation.tempDir, basename(outputPaths.json));
    const stagedManifest = join(operation.tempDir, basename(outputPaths.manifest));
    try {
      let packAsync = this.dependencies.atlasPacker;
      if (!packAsync) {
        const helperRequire = createRequire(join(this.toolchain.helperRoot, 'package.json'));
        const moduleValue = helperRequire(FREE_TEX_PACKAGE) as { packAsync?: AtlasPackAsync; default?: { packAsync?: AtlasPackAsync } };
        packAsync = moduleValue.packAsync ?? moduleValue.default?.packAsync;
      }
      if (!packAsync) throw new ImageWorkshopError(`Pinned ${FREE_TEX_PACKAGE}@${FREE_TEX_PACKER_VERSION} does not expose packAsync.`);
      const packFiles = await Promise.all(inputs.map(async (path) => ({ path: basename(path), contents: await readFile(path) })));
      const packPromise = packAsync(packFiles, {
        textureName: outputPaths.textureName,
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
      const deadline = this.dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
      let files: Array<{ name: string; buffer: Buffer }>;
      try {
        files = await Promise.race([
          packPromise,
          new Promise<never>((_, reject) => { deadlineTimer = setTimeout(() => reject(new ImageWorkshopError(`Atlas packing exceeded the ${deadline}ms operation deadline.`)), deadline); })
        ]);
      } finally {
        if (deadlineTimer) clearTimeout(deadlineTimer);
      }
      const pngFile = files.find((file) => /\.png$/i.test(file.name));
      const jsonFile = files.find((file) => /\.json$/i.test(file.name));
      if (!pngFile || !jsonFile) throw new ImageWorkshopError('Atlas helper did not return both PNG and JSON outputs.');
      await writeFile(stagedPng, pngFile.buffer, { flag: 'wx' });
      await writeFile(stagedJson, jsonFile.buffer, { flag: 'wx' });
      const atlasInfo = await this.inspect(stagedPng);
      if (atlasInfo.width > maxSize || atlasInfo.height > maxSize || atlasInfo.width * atlasInfo.height > maxPixels) throw new ImageWorkshopError(`Atlas output ${atlasInfo.width}x${atlasInfo.height} exceeds the configured resource limit.`);
      const atlasGrid = await this.pixels(stagedPng);
      const parsed = await readJsonFile(stagedJson);
      const frameObject = asObject(parsed.frames);
      if (!frameObject) throw new ImageWorkshopError('Atlas helper returned JSON without a frames object.');
      if (Object.keys(frameObject).length !== names.length) throw new ImageWorkshopError('Atlas JSON contains a frame count different from the requested input count.');
      const rectangles: Array<{ name: string; x: number; y: number; width: number; height: number; rotated: boolean; trimmed: boolean }> = [];
      for (const [index, name] of names.entries()) {
        const record = asObject(frameObject[name]);
        const frame = asObject(record?.frame);
        if (!record || !frame) throw new ImageWorkshopError(`Atlas JSON is missing exactly one frame for ${name}.`);
        const x = Number(frame.x);
        const y = Number(frame.y);
        const width = Number(frame.w);
        const height = Number(frame.h);
        const rotated = record.rotated === true;
        const trimmed = record.trimmed === true;
        if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > atlasInfo.width || y + height > atlasInfo.height) throw new ImageWorkshopError(`Atlas frame ${name} is outside the output bounds.`);
        if (rotated) throw new ImageWorkshopError(`Atlas frame ${name} was rotated despite allowRotation=false.`);
        if (options.fixedGrid && record.rotated !== false) throw new ImageWorkshopError(`Fixed-grid atlas frame ${name} is not explicitly unrotated.`);
        if (options.fixedGrid && record.trimmed !== false) throw new ImageWorkshopError(`Fixed-grid atlas frame ${name} is not explicitly untrimmed.`);
        const source = sourceGrids[index];
        const sourceSize = asObject(record.sourceSize);
        const spriteSourceSize = asObject(record.spriteSourceSize);
        const sourceWidth = Number(sourceSize?.w);
        const sourceHeight = Number(sourceSize?.h);
        if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight) || sourceWidth !== source.width || sourceHeight !== source.height || !spriteSourceSize) throw new ImageWorkshopError(`Atlas frame ${name} has incorrect source-size metadata.`);
        const sx = Number(spriteSourceSize.x);
        const sy = Number(spriteSourceSize.y);
        const sw = Number(spriteSourceSize.w);
        const sh = Number(spriteSourceSize.h);
        if (![sx, sy, sw, sh].every(Number.isInteger) || sx < 0 || sy < 0 || sw <= 0 || sh <= 0 || sx + sw > source.width || sy + sh > source.height || sw !== width || sh !== height) throw new ImageWorkshopError(`Atlas frame ${name} has invalid trim metadata.`);
        if (options.fixedGrid && (sx !== 0 || sy !== 0 || sw !== source.width || sh !== source.height || width !== source.width || height !== source.height)) throw new ImageWorkshopError(`Fixed-grid atlas frame ${name} does not cover the complete source image.`);
        const expected = cropGrid(source, sx, sy, sw, sh);
        const actual = cropGrid(atlasGrid, x, y, width, height);
        const samples = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], [Math.floor(width / 2), Math.floor(height / 2)]];
        for (const [px, py] of samples) if (actual.pixels[py * actual.width + px] !== expected.pixels[py * expected.width + px]) throw new ImageWorkshopError(`Atlas frame ${name} representative pixel verification failed.`);
        rectangles.push({ name, x, y, width, height, rotated, trimmed });
        for (const previous of rectangles.slice(0, index)) {
          if (x < previous.x + previous.width && x + width > previous.x && y < previous.y + previous.height && y + height > previous.y) throw new ImageWorkshopError(`Atlas frame ${name} overlaps ${previous.name}.`);
        }
      }
      const jsonArtifact = await jsonMetadata(stagedJson, outputPaths.json);
      const manifest: ImageOperationManifest = {
        schemaVersion: 2,
        operation: 'atlas-pack',
        toolchain: toolchainSummary(this.toolchain),
        inputs: inputInfo,
        outputs: [finalImageMetadata(atlasInfo, outputPaths.png), jsonArtifact],
        options: { outputDirectory: true, maxSize, padding, extrusion, fixedGrid: options.fixedGrid ?? false, allowRotation: false, allowTrim: options.fixedGrid ? false : true, sourceOverwrite: false },
        fidelity: { dimensions: true, sourceNamesExactlyOnce: rectangles.length === names.length, nonOverlapping: true, representativePixelsMatch: true, frames: rectangles, preview: { generated: false, reason: 'Phase 4 records artifact metadata and representative decoded pixels; it does not generate a contact-sheet preview.' } },
        verificationLevel: 'representative-pixels',
        lossless: false
      };
      await writeManifestInStage(stagedManifest, manifest);
      for (const stagedArtifact of [stagedPng, stagedJson, stagedManifest]) await assertStageFile(stagedArtifact);
      await readJsonFile(stagedManifest);
      await commitDirectory(operation);
      return { operation: 'atlas-pack', outputPaths: [outputPaths.png, outputPaths.json], manifestPath: outputPaths.manifest, manifest };
    } catch (error) {
      await removeOperation(operation);
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
    const operation = await beginFileOperation([output, manifestPathForOutput(output)], [input]);
    const staged = join(operation.tempDir, basename(output));
    try {
      const runner = this.dependencies.commandRunner ?? runCommand;
      const env = this.dependencies.env ?? process.env;
      const args = ['-o', String(level), '--strip', 'safe', '--out', staged, input];
      let result;
      try {
        result = await runner(this.toolchain.oxipng, args, { env: withoutCredentials(env), platform: this.dependencies.platform ?? process.platform, timeoutMs: this.dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS });
      } catch (error) {
        throw new ImageWorkshopError(`oxipng optimization could not start: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (result.exitCode !== 0) throw new ImageWorkshopError(`oxipng optimization failed: ${commandFailure(this.toolchain.oxipng, args, result, env).message}`);
      const outputInfo = await this.inspect(staged);
      if (outputInfo.width !== inputInfo.width || outputInfo.height !== inputInfo.height || outputInfo.hasAlpha !== inputInfo.hasAlpha) throw new ImageWorkshopError('oxipng changed image dimensions or alpha mode.');
      assertSameGrid(await this.pixels(staged), sourcePixels, 'oxipng decoded-pixel');
      return await this.finish(operation, 'optimize-png', [inputInfo], [{ finalPath: output, stagedPath: staged, metadata: finalImageMetadata(outputInfo, output) }], { level, optimizer: 'oxipng', explicit: true, sourceOverwrite: false }, { dimensions: true, alphaPreserved: true, decodedPixelsEqual: true }, 'decoded-pixels', true);
    } catch (error) {
      await removeOperation(operation);
      throw error;
    }
  }
}

export function createImageWorkshop(toolchain: ImageToolchain, dependencies: ImageWorkshopDependencies = {}): ImageWorkshop {
  return new ImageWorkshop(toolchain, dependencies);
}

export function defaultImageToolchainRoot(dshHome?: string): string {
  return resolve(dshHome ?? resolveHarnessPaths().dshHome, join('rpgmaker-mv', 'image-workshop'));
}
