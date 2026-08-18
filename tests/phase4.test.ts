import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { runCli } from '../src/cli';
import {
  createImageWorkshop,
  ensureImageHelperRuntime,
  resolveImageToolchain,
  writeImageToolchainManifest,
  type AtlasPackAsync,
  type ImageToolchain
} from '../src/image-workshop';
import { prepareRpgMakerDeployment } from '../src/rpgmaker';
import type { CommandOptions, CommandResult } from '../src/process';

const FIXTURE_ROOT = resolve('tests/fixtures/asset-workshop');
const TILE = join(FIXTURE_ROOT, 'pixel-tile.png');
const SHEET = join(FIXTURE_ROOT, 'two-frame-sheet.png');
const ICON = join(FIXTURE_ROOT, 'transparent-icon.png');
const CYAN = join(FIXTURE_ROOT, 'atlas-cyan.png');
const ORANGE = join(FIXTURE_ROOT, 'atlas-orange.png');
const NONE = '00000000';
const RED = 'FF0000FF';
const BLUE = '0000FFFF';
const GREEN = '00FF00FF';
const YELLOW = 'FFFF00FF';
const MAGENTA = 'FF00FFFF';
const CYAN_PIXEL = '00FFFFFF';
const ORANGE_PIXEL = 'FF8800FF';

interface Grid {
  width: number;
  height: number;
  pixels: string[];
}

function grid(width: number, height: number, pixels: string[]): Grid {
  expect(pixels).toHaveLength(width * height);
  return { width, height, pixels };
}

function tileGrid(): Grid {
  return grid(4, 4, [RED, RED, NONE, NONE, RED, RED, NONE, NONE, NONE, NONE, BLUE, BLUE, NONE, NONE, BLUE, BLUE]);
}

function sheetGrid(): Grid {
  return grid(8, 4, [
    GREEN, GREEN, GREEN, GREEN, YELLOW, YELLOW, YELLOW, YELLOW,
    GREEN, GREEN, GREEN, GREEN, YELLOW, YELLOW, YELLOW, YELLOW,
    GREEN, GREEN, GREEN, GREEN, YELLOW, YELLOW, YELLOW, YELLOW,
    GREEN, GREEN, GREEN, GREEN, YELLOW, YELLOW, YELLOW, YELLOW
  ]);
}

function iconGrid(): Grid {
  return grid(6, 6, [NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, MAGENTA, MAGENTA, NONE, NONE, NONE, NONE, MAGENTA, MAGENTA, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE, NONE]);
}

function crop(source: Grid, left: number, top: number, width: number, height: number): Grid {
  const pixels: string[] = [];
  for (let y = 0; y < height; y += 1) pixels.push(...source.pixels.slice((top + y) * source.width + left, (top + y) * source.width + left + width));
  return grid(width, height, pixels);
}

function appendHorizontal(sources: Grid[]): Grid {
  const pixels: string[] = [];
  for (let y = 0; y < sources[0].height; y += 1) for (const source of sources) pixels.push(...source.pixels.slice(y * source.width, (y + 1) * source.width));
  return grid(sources.reduce((sum, source) => sum + source.width, 0), sources[0].height, pixels);
}

function appendVertical(sources: Grid[]): Grid {
  return grid(sources[0].width, sources.reduce((sum, source) => sum + source.height, 0), sources.flatMap((source) => source.pixels));
}

function alphaBounds(source: Grid): { left: number; top: number; right: number; bottom: number } | undefined {
  let left = source.width;
  let top = source.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) {
    if (source.pixels[y * source.width + x].slice(-2) !== '00') {
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? undefined : { left, top, right, bottom };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

async function writeHelperState(helper: string): Promise<string> {
  await mkdir(join(helper, 'node_modules', 'free-tex-packer-core'), { recursive: true });
  await writeFile(join(helper, 'package.json'), JSON.stringify({ private: true, dependencies: { 'free-tex-packer-core': '0.3.9' } }));
  await writeFile(join(helper, 'node_modules', 'free-tex-packer-core', 'package.json'), JSON.stringify({ version: '0.3.9' }));
  await writeFile(join(helper, 'bun.lock'), JSON.stringify({
    lockfileVersion: 1,
    workspaces: { '': { dependencies: { 'free-tex-packer-core': '0.3.9' } } },
    packages: { 'free-tex-packer-core': ['free-tex-packer-core@0.3.9', '', {}, 'sha512-Ah4FuRZc57oVLOtkyUjGB9YAjF0ot3T6ccvXw/lvhkndneHwbfkrNT8yz9E7kFak26DPsWJhXS6JjYEsCJkiFA=='] }
  }));
  return helper;
}

async function helperState(root: string): Promise<string> {
  return writeHelperState(join(root, 'helper state'));
}

class FakeImageTools {
  readonly grids = new Map<string, Grid>([
    [resolve(TILE), tileGrid()],
    [resolve(SHEET), sheetGrid()],
    [resolve(ICON), iconGrid()],
    [resolve(CYAN), grid(2, 2, [CYAN_PIXEL, CYAN_PIXEL, CYAN_PIXEL, CYAN_PIXEL])],
    [resolve(ORANGE), grid(2, 2, [ORANGE_PIXEL, ORANGE_PIXEL, ORANGE_PIXEL, ORANGE_PIXEL])]
  ]);
  readonly opaque = new Set<string>();
  readonly calls: Array<{ command: string; args: string[]; options: CommandOptions }> = [];
  failFor?: string;
  racePath?: string;
  atlasGrid?: Grid;
  corruptAtlas = false;

  private sourcePath(args: string[]): string | undefined {
    return args.find((value) => this.grids.has(resolve(value)));
  }

  private virtual(path: string): Grid | undefined {
    const value = this.grids.get(resolve(path));
    if (value) return value;
    if (this.atlasGrid && (path.includes('.dsh-image-operation-') || path.includes('.dsh-staging-')) && /\.png$/i.test(path)) {
      this.grids.set(resolve(path), this.atlasGrid);
      return this.atlasGrid;
    }
    return undefined;
  }

  private outputPath(args: string[]): string | undefined {
    return [...args].reverse().find((value) => /\.png$/i.test(value));
  }

  private writeVirtual(path: string, value: Grid): void {
    this.grids.set(resolve(path), value);
  }

  private async materialize(path: string): Promise<void> {
    await mkdir(dirname(resolve(path)), { recursive: true });
    await writeFile(path, `fixture-output:${path}\n`);
    if (this.racePath) {
      await writeFile(this.racePath, 'unowned racer output\n');
      this.racePath = undefined;
    }
  }

  async run(command: string, args: string[], options: CommandOptions): Promise<CommandResult> {
    this.calls.push({ command, args, options });
    if (args[0] === '--version') return { exitCode: 0, stdout: command.toLowerCase().includes('oxipng') ? 'oxipng 10.2.0\n' : 'Version: ImageMagick 7.1.2-29 Q16\n', stderr: '' };
    if (this.failFor && args.some((value) => value.includes(this.failFor!))) return { exitCode: 7, stdout: '', stderr: 'malformed input' };
    if (args[0] === 'add') {
      const cwd = options.cwd!;
      if (args.some((value) => value.includes('free-tex-packer-core'))) {
        await writeHelperState(cwd);
      } else {
        await mkdir(join(cwd, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'dist'), { recursive: true });
        await mkdir(join(cwd, 'node_modules', '.bin'), { recursive: true });
        await writeFile(join(cwd, 'package.json'), JSON.stringify({ dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } }));
        await writeFile(join(cwd, 'bun.lock'), JSON.stringify({ lockfileVersion: 1, workspaces: { '': { dependencies: { '@xerolo44/rpgmaker-mv-mcp': '0.1.0' } } }, packages: { '@xerolo44/rpgmaker-mv-mcp': ['@xerolo44/rpgmaker-mv-mcp@0.1.0', '', { dependencies: { '@modelcontextprotocol/sdk': '^1.12.0', selfsigned: '^5.5.0', zod: '^3.24.0' }, bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }, 'sha512-oXdkSGKGiYAtexcoZBXhyUQub6zoYQ4tMU2aKTjAcqeKhUpQ4BypjuS0EYJ78/7zmOq3TwFNBkEaZyb8q+SGuA=='] } }));
        await writeFile(join(cwd, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'package.json'), JSON.stringify({ version: '0.1.0', bin: { 'rpgmaker-mv-mcp': 'dist/index.js' } }));
        await writeFile(join(cwd, 'node_modules', '@xerolo44', 'rpgmaker-mv-mcp', 'dist', 'index.js'), 'fixture');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'pm') return { exitCode: 0, stdout: '', stderr: '' };
    if (args.includes('--dump-config')) return { exitCode: 0, stdout: '- id: mcp-rpgmaker-mv\n- id: agent-presets\n', stderr: '' };
    if (command.toLowerCase().includes('oxipng')) {
      const source = this.sourcePath(args.slice().reverse()) ?? args.at(-1)!;
      const output = args[args.indexOf('--out') + 1];
      const value = this.virtual(source);
      if (!value) return { exitCode: 1, stdout: '', stderr: 'unknown image' };
      this.writeVirtual(output, value);
      await this.materialize(output);
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args.includes('-format')) {
      const path = this.sourcePath(args) ?? this.outputPath(args);
      const value = path ? this.virtual(path) : undefined;
      if (!value) return { exitCode: 1, stdout: '', stderr: 'unknown image' };
      const alpha = args.includes('-alpha') ? args[args.indexOf('-alpha') + 1] === 'on' : !this.opaque.has(resolve(path!));
      return { exitCode: 0, stdout: `${value.width}|${value.height}|PNG|${alpha ? 'srgba' : 'srgb'}|${alpha ? 'False' : 'True'}\n`, stderr: '' };
    }
    if (args.at(-1) === 'txt:-') {
      const path = this.sourcePath(args) ?? this.outputPath(args);
      const value = path ? this.virtual(path) : undefined;
      if (!value) return { exitCode: 1, stdout: '', stderr: 'unknown image' };
      const lines = [`# ImageMagick pixel enumeration: ${value.width},${value.height},0,255,srgba`];
      for (let y = 0; y < value.height; y += 1) for (let x = 0; x < value.width; x += 1) lines.push(`${x},${y}: (0,0,0,0) #${value.pixels[y * value.width + x]} none`);
      return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
    }
    const input = this.sourcePath(args);
    const source = input ? this.virtual(input) : undefined;
    const output = this.outputPath(args);
    if (!source || !output) return { exitCode: 1, stdout: '', stderr: 'fake ImageMagick could not identify input/output' };
    if (args.includes('-resize')) {
      const match = args[args.indexOf('-resize') + 1].match(/^(\d+)x(\d+)!$/)!;
      const scale = Number(match[1]) / source.width;
      const pixels: string[] = [];
      for (let y = 0; y < source.height; y += 1) for (let sy = 0; sy < scale; sy += 1) for (let x = 0; x < source.width; x += 1) for (let sx = 0; sx < scale; sx += 1) pixels.push(source.pixels[y * source.width + x]);
      this.writeVirtual(output, grid(Number(match[1]), Number(match[2]), pixels));
      await this.materialize(output);
    } else if (args.includes('-crop') || args.includes('-trim') || args.includes('-extent')) {
      const cropArgument = args.includes('-crop') ? args[args.indexOf('-crop') + 1] : `${source.width}x${source.height}`;
      const match = cropArgument.match(/^(\d+)x(\d+)$/)!;
      if (output.includes('%04d')) {
        let index = 0;
        for (let y = 0; y < source.height; y += Number(match[2])) for (let x = 0; x < source.width; x += Number(match[1])) {
          const path = output.replace('%04d', String(index).padStart(4, '0'));
          this.writeVirtual(path, crop(source, x, y, Number(match[1]), Number(match[2])));
          await this.materialize(path);
          index += 1;
        }
      } else {
        let value = source;
        if (args.includes('-trim')) {
          const bounds = alphaBounds(source);
          if (bounds) value = crop(source, bounds.left, bounds.top, bounds.right - bounds.left + 1, bounds.bottom - bounds.top + 1);
        }
        const extentIndex = args.indexOf('-extent');
        if (extentIndex >= 0) {
          const [width, height] = args[extentIndex + 1].split('x').map(Number);
          const padded = Array(width * height).fill(NONE);
          const left = Math.floor((width - value.width) / 2);
          const top = Math.floor((height - value.height) / 2);
          for (let y = 0; y < value.height; y += 1) for (let x = 0; x < value.width; x += 1) padded[(top + y) * width + left + x] = value.pixels[y * value.width + x];
          value = grid(width, height, padded);
        }
        this.writeVirtual(output, value);
        await this.materialize(output);
      }
    } else if (args.includes('+append')) {
      const sourcePaths = args.filter((value) => this.grids.has(resolve(value)));
      this.writeVirtual(output, appendHorizontal(sourcePaths.map((path) => this.grids.get(resolve(path))!)));
      await this.materialize(output);
    } else if (args.includes('-append')) {
      const sourcePaths = args.filter((value) => this.grids.has(resolve(value)));
      this.writeVirtual(output, appendVertical(sourcePaths.map((path) => this.grids.get(resolve(path))!)));
      await this.materialize(output);
    } else {
      this.writeVirtual(output, source);
      await this.materialize(output);
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

function toolchain(root: string, imageMagick: string, helperRoot: string, fake: FakeImageTools, oxipng?: string): ImageToolchain {
  return {
    toolchainRoot: root,
    manifestPath: join(root, 'toolchain.json'),
    imageMagick,
    imageMagickVersion: '7.1.2-29',
    imageMagickSha256: hash('fixture executable'),
    imageMagickUrl: 'https://example.invalid/ImageMagick-7.1.2-29-test.7z',
    imageMagickArchiveSha256: 'a'.repeat(64),
    helperRoot,
    helperPackagePath: join(helperRoot, 'node_modules', 'free-tex-packer-core', 'package.json'),
    helperPackageVersion: '0.3.9',
    helperLockPath: join(helperRoot, 'bun.lock'),
    helperLockSha256: 'b'.repeat(64),
    helperIntegrity: 'sha512-Ah4FuRZc57oVLOtkyUjGB9YAjF0ot3T6ccvXw/lvhkndneHwbfkrNT8yz9E7kFak26DPsWJhXS6JjYEsCJkiFA==',
    ...(oxipng ? { oxipng, oxipngVersion: '10.2.0', oxipngSha256: hash('fixture oxipng'), oxipngUrl: 'https://example.invalid/oxipng-10.2.0-test.zip', oxipngArchiveSha256: 'c'.repeat(64) } : {}),
    optionalEnhancements: {}
  };
}

function atlasPacker(fake: FakeImageTools, broken = false): AtlasPackAsync {
  return async (_files, _config) => {
    const atlas = grid(5, 2, [CYAN_PIXEL, CYAN_PIXEL, NONE, ORANGE_PIXEL, ORANGE_PIXEL, CYAN_PIXEL, CYAN_PIXEL, NONE, ORANGE_PIXEL, ORANGE_PIXEL]);
    fake.atlasGrid = broken ? grid(5, 2, Array(10).fill(NONE)) : atlas;
    const json = {
      frames: {
        'atlas-cyan.png': { frame: { x: 0, y: 0, w: 2, h: 2 }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: 2, h: 2 }, sourceSize: { w: 2, h: 2 } },
        'atlas-orange.png': { frame: { x: 3, y: 0, w: 2, h: 2 }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: 2, h: 2 }, sourceSize: { w: 2, h: 2 } }
      },
      meta: { size: { w: 5, h: 2 } }
    };
    return [{ name: 'atlas.png', buffer: Buffer.from('png') }, { name: 'atlas.json', buffer: Buffer.from(JSON.stringify(json)) }];
  };
}

function ioBuffer() {
  let stdout = '';
  let stderr = '';
  return { get stdout() { return stdout; }, get stderr() { return stderr; }, io: { stdout: { write: (text: string) => { stdout += text; } }, stderr: { write: (text: string) => { stderr += text; } } } };
}

describe('Asset Workshop trust and safe outputs', () => {
  test('requires exact app-owned checksum pins and verifies optional oxipng every time', async () => {
    const root = await temp('phase4-trust');
    try {
      const helper = await helperState(root);
      const image = join(root, 'tools with spaces', 'magick.exe');
      await mkdir(dirname(image), { recursive: true });
      await writeFile(image, 'fixture executable');
      const fake = new FakeImageTools();
      await expect(resolveImageToolchain({ platform: 'win32', env: { PATH: '' }, imageMagickExecutable: image, helperRoot: helper, commandRunner: fake.run.bind(fake) })).rejects.toThrow(/SHA-256/i);
      const resolved = await resolveImageToolchain({ platform: 'win32', env: { PATH: '' }, imageMagickExecutable: image, imageMagickSha256: hash('fixture executable'), helperRoot: helper, commandRunner: fake.run.bind(fake) });
      expect(resolved.imageMagickVersion).toBe('7.1.2-29');
      const manifestPath = join(root, 'toolchain', 'toolchain.json');
      const manifestToolchain = { ...resolved, toolchainRoot: join(root, 'toolchain'), manifestPath };
      await writeImageToolchainManifest(manifestToolchain);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      expect(manifest.format).toBe(2);
      expect(manifest.imageMagick.url).toContain('7.1.2-29');
      expect(manifest.imageMagick.sha256).toBe(hash('fixture executable'));
      expect(manifest.helper.integrity).toContain('sha512-');
      await writeFile(join(root, 'oxipng.exe'), 'fixture oxipng');
      const optional = await resolveImageToolchain({ platform: 'win32', env: { PATH: '' }, imageMagickExecutable: image, imageMagickSha256: hash('fixture executable'), helperRoot: helper, oxipngExecutable: join(root, 'oxipng.exe'), oxipngSha256: hash('fixture oxipng'), commandRunner: fake.run.bind(fake) });
      expect(optional.oxipngVersion).toBe('10.2.0');
      expect(fake.calls.filter((call) => call.command.endsWith('oxipng.exe') && call.args[0] === '--version')).toHaveLength(1);
      await writeFile(image, 'tampered');
      await expect(resolveImageToolchain({ platform: 'win32', env: { PATH: '' }, imageMagickExecutable: image, imageMagickSha256: hash('fixture executable'), helperRoot: helper, commandRunner: fake.run.bind(fake) })).rejects.toThrow(/checksum/i);
      const helperInstallRoot = join(root, 'installed-helper');
      await ensureImageHelperRuntime({ helperRuntimeDir: helperInstallRoot, dshHome: root, env: { PATH: '' }, commandRunner: fake.run.bind(fake) });
      const siblings = await readdir(dirname(helperInstallRoot));
      expect(siblings.some((name) => name.includes('.staging-') || name.includes('.rollback-'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('uses one staging operation directory, rejects symlink escapes/races/source collisions, and leaves no claimed manifest on failure', async () => {
    const root = await temp('phase4-safety');
    try {
      const helper = await helperState(root);
      const image = join(root, 'magick');
      await writeFile(image, 'fixture executable');
      const fake = new FakeImageTools();
      const workshop = createImageWorkshop(toolchain(root, image, helper, fake), { platform: 'win32', env: { PATH: '' }, commandRunner: fake.run.bind(fake) });
      const output = join(root, 'nested output', 'tile.png');
      const result = await workshop.resizePixel({ input: TILE, output, scale: 2 });
      expect(result.manifest.verificationLevel).toBe('decoded-pixels');
      expect(await readFile(result.manifestPath, 'utf8')).toContain('resize-pixel');
      await expect(workshop.resizePixel({ input: TILE, output: TILE, scale: 2 })).rejects.toThrow(/source image/i);
      const existing = join(root, 'existing', 'out.png');
      await mkdir(dirname(existing), { recursive: true });
      await writeFile(existing, 'keep me');
      await expect(workshop.resizePixel({ input: TILE, output: existing, scale: 2 })).rejects.toThrow(/existing output/i);
      expect(await readFile(existing, 'utf8')).toBe('keep me');
      const linkedParent = join(root, 'linked-parent');
      await symlink(root, linkedParent, 'dir');
      await expect(workshop.resizePixel({ input: TILE, output: join(linkedParent, 'escape.png'), scale: 2 })).rejects.toThrow(/symlink|junction/i);
      const raced = join(root, 'race', 'raced.png');
      fake.racePath = raced;
      await expect(workshop.resizePixel({ input: TILE, output: raced, scale: 2 })).rejects.toThrow(/existing output|racing|appeared/i);
      expect(await readFile(raced, 'utf8')).toBe('unowned racer output\n');
      fake.failFor = 'tile.png';
      const failedOutput = join(root, 'failed', 'output.png');
      await expect(workshop.resizePixel({ input: TILE, output: failedOutput, scale: 2 })).rejects.toThrow(/failed|malformed/i);
      expect(await Bun.file(`${failedOutput}.manifest.json`).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Asset Workshop image correctness and atlas bounds', () => {
  test('handles opaque transparent padding, fully transparent trim, sheets, and truthful atlas artifacts', async () => {
    const root = await temp('phase4-workflow');
    try {
      const helper = await helperState(root);
      const image = join(root, 'magick');
      await writeFile(image, 'fixture executable');
      const opaque = join(root, 'opaque.png');
      await writeFile(opaque, 'opaque fixture');
      const fake = new FakeImageTools();
      fake.grids.set(resolve(opaque), grid(2, 2, [RED, RED, RED, RED]));
      fake.opaque.add(resolve(opaque));
      const workshop = createImageWorkshop(toolchain(root, image, helper, fake), { platform: 'win32', env: { PATH: '' }, commandRunner: fake.run.bind(fake), maxPixels: 100, atlasPacker: atlasPacker(fake) });
      const padded = await workshop.trimPad({ input: opaque, output: join(root, 'padded.png'), trim: false, width: 4, height: 4 });
      expect(padded.manifest.fidelity).toMatchObject({ alphaChannelAddedForPadding: true, alphaPreserved: true });
      expect(padded.manifest.outputs[0]).toMatchObject({ hasAlpha: true, width: 4, height: 4 });
      const transparent = await workshop.trimPad({ input: ICON, output: join(root, 'transparent.png'), trim: true });
      expect(transparent.manifest.fidelity).toMatchObject({ sourceAlphaBounds: { left: 2, top: 2, right: 3, bottom: 3 } });
      const fullyTransparent = join(root, 'fully-transparent.png');
      await writeFile(fullyTransparent, 'transparent fixture');
      fake.grids.set(resolve(fullyTransparent), grid(3, 3, Array(9).fill(NONE)));
      const preserved = await workshop.trimPad({ input: fullyTransparent, output: join(root, 'preserved.png'), trim: true });
      expect(preserved.manifest.fidelity).toMatchObject({ sourceAlphaBounds: null, trimmedSize: { width: 3, height: 3 } });
      const frames = await workshop.sheetSlice({ input: SHEET, outputDir: join(root, 'frames'), cellWidth: 4, cellHeight: 4 });
      expect(frames.outputPaths).toHaveLength(2);
      fake.grids.set(resolve(frames.outputPaths[0]), grid(4, 4, Array(16).fill(GREEN)));
      fake.grids.set(resolve(frames.outputPaths[1]), grid(4, 4, Array(16).fill(YELLOW)));
      const assembled = await workshop.sheetAssemble({ inputs: frames.outputPaths, output: join(root, 'assembled.png'), columns: 2 });
      expect(assembled.manifest.fidelity).toMatchObject({ pixelsMatch: true });
      const atlas = await workshop.atlasPack({ inputs: [CYAN, ORANGE], output: join(root, 'atlas.png'), maxSize: 8, padding: 1, extrusion: 1, fixedGrid: true });
      expect(atlas.outputPaths).toEqual([join(root, 'atlas.png'), join(root, 'atlas.json')]);
      expect(atlas.manifest.outputs).toHaveLength(2);
      expect(atlas.manifest.verificationLevel).toBe('representative-pixels');
      expect(atlas.manifest.lossless).toBe(false);
      expect(atlas.manifest.fidelity).toMatchObject({ sourceNamesExactlyOnce: true, nonOverlapping: true, representativePixelsMatch: true });
      const oxipng = join(root, 'oxipng');
      await writeFile(oxipng, 'fixture oxipng');
      const optimizer = createImageWorkshop(toolchain(root, image, helper, fake, oxipng), { platform: 'win32', env: { PATH: '' }, commandRunner: fake.run.bind(fake) });
      const optimized = await optimizer.optimizePng({ input: TILE, output: join(root, 'optimized.png'), level: 4 });
      expect(optimized.manifest.fidelity).toMatchObject({ decodedPixelsEqual: true, alphaPreserved: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects blank/corrupt atlas output and aggregate/max-size oversize inputs before claiming success', async () => {
    const root = await temp('phase4-atlas-safety');
    try {
      const helper = await helperState(root);
      const image = join(root, 'magick');
      await writeFile(image, 'fixture executable');
      const fake = new FakeImageTools();
      const workshop = createImageWorkshop(toolchain(root, image, helper, fake), { platform: 'win32', env: { PATH: '' }, commandRunner: fake.run.bind(fake), maxPixels: 32, timeoutMs: 10 });
      await expect(workshop.atlasPack({ inputs: [CYAN, ORANGE], output: join(root, 'blank.png'), maxSize: 8, fixedGrid: true })).rejects.toThrow(/resource limit/i);
      const bounded = createImageWorkshop(toolchain(root, image, helper, fake), { platform: 'win32', env: { PATH: '' }, commandRunner: fake.run.bind(fake), maxPixels: 64, timeoutMs: 1000, atlasPacker: atlasPacker(fake, true) });
      await expect(bounded.atlasPack({ inputs: [CYAN, ORANGE], output: join(root, 'blank.png'), maxSize: 8, fixedGrid: true })).rejects.toThrow(/representative pixel/i);
      const corrupt = createImageWorkshop(toolchain(root, image, helper, fake), { platform: 'win32', env: { PATH: '' }, commandRunner: fake.run.bind(fake), maxPixels: 64, timeoutMs: 1000, atlasPacker: async () => {
        fake.atlasGrid = grid(5, 2, Array(10).fill(NONE));
        return [{ name: 'atlas.png', buffer: Buffer.from('png') }, { name: 'atlas.json', buffer: Buffer.from('{"frames":{}}') }];
      } });
      await expect(corrupt.atlasPack({ inputs: [CYAN, ORANGE], output: join(root, 'corrupt.png'), maxSize: 8, fixedGrid: true })).rejects.toThrow(/frame count|frames object/i);
      const timeout = createImageWorkshop(toolchain(root, image, helper, fake), { platform: 'win32', env: { PATH: '' }, commandRunner: fake.run.bind(fake), maxPixels: 64, timeoutMs: 10, atlasPacker: () => new Promise(() => undefined) });
      await expect(timeout.atlasPack({ inputs: [CYAN], output: join(root, 'timeout.png'), maxSize: 4 })).rejects.toThrow(/deadline/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Asset Workshop CLI and real preset preparation seam', () => {
  test('CLI uses test-owned helper state and explicit checksums', async () => {
    const root = await temp('phase4-cli');
    try {
      const helper = await helperState(root);
      const image = join(root, 'magick');
      await writeFile(image, 'fixture executable');
      const fake = new FakeImageTools();
      const buffers = ioBuffer();
      const output = join(root, 'cli-output.png');
      const code = await runCli(['image', 'resize-pixel', '--input', TILE, '--output', output, '--scale', '2'], { platform: 'win32', env: { PATH: '', DSH_IMAGE_MAGICK: image, DSH_IMAGE_MAGICK_SHA256: hash('fixture executable'), DSH_IMAGE_HELPER_ROOT: helper, DSH_HOME: join(root, 'dsh-home') }, commandRunner: fake.run.bind(fake), io: buffers.io });
      expect(code).toBe(0);
      expect(JSON.parse(buffers.stdout).operation).toBe('resize-pixel');
      fake.failFor = 'pixel-tile.png';
      const failed = await runCli(['image', 'inspect', '--input', TILE], { platform: 'win32', env: { PATH: '', DSH_IMAGE_MAGICK: image, DSH_IMAGE_MAGICK_SHA256: hash('fixture executable'), DSH_IMAGE_HELPER_ROOT: helper }, commandRunner: fake.run.bind(fake), io: buffers.io });
      expect(failed).toBe(1);
      expect(buffers.stderr).toMatch(/failed|malformed/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('mount preparation installs asset-workshop without duplicating MCP rows', async () => {
    const root = await temp('phase4-preset');
    try {
      const project = join(root, '选择 project with spaces');
      await mkdir(join(project, 'data'), { recursive: true });
      await mkdir(join(project, 'js'), { recursive: true });
      await writeFile(join(project, 'Game.rpgproject'), '{}\n');
      const dshRuntime = join(root, 'dsh-runtime');
      await mkdir(join(dshRuntime, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code'), { recursive: true });
      await mkdir(join(dshRuntime, 'node_modules', '@deepseek-ai', 'dsh', 'bin'), { recursive: true });
      await writeFile(join(dshRuntime, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), JSON.stringify({ version: '0.1.0-rc.6', bin: { dsh: 'bin/dsh.js' } }));
      await writeFile(join(dshRuntime, 'node_modules', '@deepseek-ai', 'dsh', 'bin', 'dsh.js'), 'fixture');
      await writeFile(join(dshRuntime, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code', 'agent.cordis.yml'), "- id: code-tool\n  name: fake\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n");
      const bun = join(root, 'bun.exe');
      const dsh = join(root, 'dsh.exe');
      const magick = join(root, 'tools with spaces', 'magick.exe');
      await writeFile(bun, 'fixture');
      await writeFile(dsh, 'fixture');
      await mkdir(dirname(magick), { recursive: true });
      await writeFile(magick, 'fixture');
      const fake = new FakeImageTools();
      const deployment = await prepareRpgMakerDeployment({ platform: 'win32', dshHome: join(root, 'dsh-home'), runtimeDir: dshRuntime, projectPath: project, agentPreset: 'asset-workshop', imageMagickExecutable: magick, imageMagickSha256: hash('fixture'), sourceRoot: join(process.cwd(), 'presets', 'rpgmaker'), jsExecutable: bun, dshExecutable: dsh, commandRunner: fake.run.bind(fake), schemaProbe: async () => ({ tools: ['get_project_info', 'list_records', 'get_record', 'update_record', 'create_record', 'create_event', 'get_event', 'update_event', 'add_dialogue', 'update_map', 'get_map', 'configure_plugin', 'list_plugins', 'validate_project', 'list_backups', 'restore_backup', 'playtest_start', 'playtest_status', 'playtest_log', 'playtest_stop'].map((name) => ({ name, inputSchema: { type: 'object' } })) }) });
      expect(deployment.agentPreset).toBe('asset-workshop');
      expect(deployment.imageToolchain?.imageMagickVersion).toBe('7.1.2-29');
      expect(await readFile(join(deployment.presetDir, 'skills', 'asset-workshop', 'SKILL.md'), 'utf8')).toContain('resize-pixel');
      const composition = await readFile(deployment.compositionPath, 'utf8');
      expect(composition).toContain('default: asset-workshop');
      expect((composition.match(/id: mcp-rpgmaker-mv/g) ?? [])).toHaveLength(1);
      expect(await readFile(deployment.imageToolchain!.manifestPath, 'utf8')).toContain('"format": 2');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
