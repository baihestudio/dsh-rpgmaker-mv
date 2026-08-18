import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { runCli } from '../src/cli';
import {
  createImageWorkshop,
  resolveImageToolchain,
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
  return grid(4, 4, [
    RED, RED, NONE, NONE,
    RED, RED, NONE, NONE,
    NONE, NONE, BLUE, BLUE,
    NONE, NONE, BLUE, BLUE
  ]);
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
  return grid(6, 6, [
    NONE, NONE, NONE, NONE, NONE, NONE,
    NONE, NONE, NONE, NONE, NONE, NONE,
    NONE, NONE, MAGENTA, MAGENTA, NONE, NONE,
    NONE, NONE, MAGENTA, MAGENTA, NONE, NONE,
    NONE, NONE, NONE, NONE, NONE, NONE,
    NONE, NONE, NONE, NONE, NONE, NONE
  ]);
}

function crop(source: Grid, left: number, top: number, width: number, height: number): Grid {
  const pixels: string[] = [];
  for (let y = 0; y < height; y += 1) {
    pixels.push(...source.pixels.slice((top + y) * source.width + left, (top + y) * source.width + left + width));
  }
  return grid(width, height, pixels);
}

function appendHorizontal(sources: Grid[]): Grid {
  const pixels: string[] = [];
  for (let y = 0; y < sources[0].height; y += 1) {
    for (const source of sources) pixels.push(...source.pixels.slice(y * source.width, (y + 1) * source.width));
  }
  return grid(sources.reduce((sum, source) => sum + source.width, 0), sources[0].height, pixels);
}

function appendVertical(sources: Grid[]): Grid {
  return grid(sources[0].width, sources.reduce((sum, source) => sum + source.height, 0), sources.flatMap((source) => source.pixels));
}

class FakeImageTools {
  readonly grids = new Map<string, Grid>([
    [resolve(TILE), tileGrid()],
    [resolve(SHEET), sheetGrid()],
    [resolve(ICON), iconGrid()],
    [resolve(CYAN), grid(2, 2, [CYAN_PIXEL, CYAN_PIXEL, CYAN_PIXEL, CYAN_PIXEL])],
    [resolve(ORANGE), grid(2, 2, [ORANGE_PIXEL, ORANGE_PIXEL, ORANGE_PIXEL, ORANGE_PIXEL])]
  ]);
  readonly calls: Array<{ command: string; args: string[]; options: CommandOptions }> = [];
  failFor?: string;

  private sourcePath(args: string[]): string | undefined {
    return args.find((value) => this.grids.has(resolve(value)));
  }

  private outputPath(args: string[]): string | undefined {
    return [...args].reverse().find((value) => value.endsWith('.png'));
  }

  private writeVirtual(path: string, value: Grid): void {
    this.grids.set(resolve(path), value);
  }

  private async materialize(path: string): Promise<void> {
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, `fixture-output:${path}\n`);
  }

  async run(command: string, args: string[], options: CommandOptions): Promise<CommandResult> {
    this.calls.push({ command, args, options });
    if (args[0] === '--version') {
      if (command.toLowerCase().includes('oxipng')) return { exitCode: 0, stdout: 'oxipng 10.2.0\n', stderr: '' };
      return { exitCode: 0, stdout: 'Version: ImageMagick 7.1.2-29 Q16\n', stderr: '' };
    }
    const failFor = this.failFor;
    if (failFor && args.some((value) => value.includes(failFor))) return { exitCode: 7, stdout: '', stderr: 'malformed input' };
    if (args[0] === 'add') {
      const cwd = options.cwd!;
      if (args.some((value) => value.includes('free-tex-packer-core'))) {
        await mkdir(join(cwd, 'node_modules', 'free-tex-packer-core'), { recursive: true });
        await writeFile(join(cwd, 'node_modules', 'free-tex-packer-core', 'package.json'), JSON.stringify({ version: '0.3.9' }));
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

    if (args.includes('-format')) {
      const path = this.sourcePath(args) ?? this.outputPath(args);
      let value = path ? this.grids.get(resolve(path)) : undefined;
      if (!value && path?.includes('atlas')) {
        value = grid(6, 12, Array(72).fill(NONE));
        this.writeVirtual(path, value);
      }
      if (!value) return { exitCode: 1, stdout: '', stderr: 'unknown image' };
      return { exitCode: 0, stdout: `${value.width}|${value.height}|PNG|srgba|False\n`, stderr: '' };
    }
    if (args.at(-1) === 'txt:-') {
      const path = this.sourcePath(args) ?? this.outputPath(args);
      const value = path ? this.grids.get(resolve(path)) : undefined;
      if (!value) return { exitCode: 1, stdout: '', stderr: 'unknown image' };
      const lines = [`# ImageMagick pixel enumeration: ${value.width},${value.height},0,255,srgba`];
      for (let y = 0; y < value.height; y += 1) for (let x = 0; x < value.width; x += 1) lines.push(`${x},${y}: (0,0,0,0) #${value.pixels[y * value.width + x]} none`);
      return { exitCode: 0, stdout: `${lines.join('\n')}\n`, stderr: '' };
    }

    const input = this.sourcePath(args);
    const source = input ? this.grids.get(resolve(input)) : undefined;
    const output = this.outputPath(args);
    if (!source || !output) return { exitCode: 1, stdout: '', stderr: 'fake ImageMagick could not identify input/output' };

    if (args.includes('-resize')) {
      const match = args[args.indexOf('-resize') + 1].match(/^(\d+)x(\d+)!$/)!;
      const scale = Number(match[1]) / source.width;
      const pixels: string[] = [];
      for (const row of source.pixels.reduce<string[][]>((rows, pixel, index) => {
        const row = Math.floor(index / source.width);
        (rows[row] ??= []).push(pixel);
        return rows;
      }, [])) for (let sy = 0; sy < scale; sy += 1) for (const pixel of row) for (let sx = 0; sx < scale; sx += 1) pixels.push(pixel);
      this.writeVirtual(output, grid(Number(match[1]), Number(match[2]), pixels));
      await this.materialize(output);
    } else if (args.includes('-crop') || args.includes('-trim')) {
      const cropArgument = args.includes('-crop') ? args[args.indexOf('-crop') + 1] : `${source.width}x${source.height}`;
      const match = cropArgument.match(/^(\d+)x(\d+)$/)!;
      if (output.includes('%04d')) {
        const cellWidth = Number(match[1]);
        const cellHeight = Number(match[2]);
        let index = 0;
        for (let y = 0; y < source.height; y += cellHeight) for (let x = 0; x < source.width; x += cellWidth) {
          const path = output.replace('%04d', String(index).padStart(4, '0'));
          this.writeVirtual(path, crop(source, x, y, cellWidth, cellHeight));
          await this.materialize(path);
          index += 1;
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      let value = source;
      if (args.includes('-trim')) value = crop(source, 2, 2, 2, 2);
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
    } else if (args.includes('+append')) {
      const sourcePaths = args.filter((value) => this.grids.has(resolve(value)));
      const value = appendHorizontal(sourcePaths.map((path) => this.grids.get(resolve(path))!));
      this.writeVirtual(output, value);
      await this.materialize(output);
    } else if (args.includes('-append')) {
      const sourcePaths = args.filter((value) => this.grids.has(resolve(value)));
      const value = appendVertical(sourcePaths.map((path) => this.grids.get(resolve(path))!));
      this.writeVirtual(output, value);
      await this.materialize(output);
    } else if (command.toLowerCase().includes('oxipng')) {
      const outIndex = args.indexOf('--out');
      const sourcePath = args.at(-1)!;
      const target = args[outIndex + 1];
      this.writeVirtual(target, this.grids.get(resolve(sourcePath))!);
      await this.materialize(target);
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

function toolchain(root: string, imageMagick: string, runner: FakeImageTools, oxipng?: string): ImageToolchain {
  return {
    toolchainRoot: root,
    manifestPath: join(root, 'toolchain.json'),
    imageMagick,
    imageMagickVersion: '7.1.2-29',
    helperRoot: process.cwd(),
    helperPackagePath: join(process.cwd(), 'node_modules', 'free-tex-packer-core', 'package.json'),
    helperPackageVersion: '0.3.9',
    ...(oxipng ? { oxipng, oxipngVersion: '10.2.0' } : {}),
    optionalEnhancements: {}
  };
}

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

function ioBuffer(): { stdout: string; stderr: string; io: { stdout: { write: (text: string) => unknown }; stderr: { write: (text: string) => unknown } } } {
  let stdout = '';
  let stderr = '';
  return {
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    io: { stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } } }
  };
}

describe('Asset Workshop toolchain and workflow', () => {
  test('resolves exact app-owned pins and treats optional apps as hints', async () => {
    const root = await temp('phase4-toolchain');
    try {
      const imageMagick = join(root, 'tools with spaces', 'magick.exe');
      const helperRoot = join(root, 'helper');
      await mkdir(dirname(imageMagick), { recursive: true });
      await writeFile(imageMagick, 'fixture executable');
      await mkdir(join(helperRoot, 'node_modules', 'free-tex-packer-core'), { recursive: true });
      await writeFile(join(helperRoot, 'node_modules', 'free-tex-packer-core', 'package.json'), JSON.stringify({ version: '0.3.9' }));
      const fake = new FakeImageTools();
      const resolved = await resolveImageToolchain({ platform: 'win32', env: { PATH: '' }, imageMagickExecutable: imageMagick, helperRoot, commandRunner: fake.run.bind(fake) });
      expect(resolved.imageMagick).toBe(imageMagick);
      expect(resolved.imageMagickVersion).toBe('7.1.2-29');
      expect(resolved.helperPackageVersion).toBe('0.3.9');
      expect(resolved.oxipng).toBeUndefined();
      expect(resolved.optionalEnhancements).toEqual({});
      expect(fake.calls[0].args).toEqual(['--version']);
      const oxipng = join(root, 'oxipng.exe');
      await writeFile(oxipng, 'fixture executable');
      const optional = await resolveImageToolchain({ platform: 'win32', env: { PATH: '' }, imageMagickExecutable: imageMagick, helperRoot, oxipngExecutable: oxipng, commandRunner: fake.run.bind(fake) });
      expect(optional.oxipngVersion).toBeUndefined();
      expect(fake.calls.filter((call) => call.command === oxipng)).toHaveLength(0);
      const verified = await resolveImageToolchain({ platform: 'win32', env: { PATH: '' }, imageMagickExecutable: imageMagick, helperRoot, oxipngExecutable: oxipng, verifyOxipng: true, commandRunner: fake.run.bind(fake) });
      expect(verified.oxipngVersion).toBe('10.2.0');
      expect(fake.calls.some((call) => call.command === oxipng && call.args[0] === '--version')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('performs pixel-safe resize, alpha trim/pad, fixed-grid slicing/assembly, and refuses collisions', async () => {
    const root = await temp('phase4-workflow');
    try {
      const imageMagick = join(root, 'magick');
      await writeFile(imageMagick, 'fixture executable');
      const fake = new FakeImageTools();
      const workshop = createImageWorkshop(toolchain(root, imageMagick, fake), { platform: 'win32', env: { PATH: '' }, commandRunner: fake.run.bind(fake) });
      const resized = join(root, 'nested output', 'tile-2x.png');
      const resizedResult = await workshop.resizePixel({ input: TILE, output: resized, scale: 2 });
      expect(resizedResult.manifest.operation).toBe('resize-pixel');
      expect(resizedResult.manifest.fidelity).toMatchObject({ nearestNeighbor: true, pixelsMatch: true, alphaPreserved: true });
      expect(JSON.parse(await readFile(resizedResult.manifestPath, 'utf8')).outputs[0].width).toBe(8);
      expect(fake.calls.find((call) => call.args.includes('-filter'))?.args).toContain('point');
      await expect(workshop.resizePixel({ input: TILE, output: TILE, scale: 2 })).rejects.toThrow(/overwrite source/i);

      const padded = await workshop.trimPad({ input: ICON, output: join(root, 'icon-padded.png'), trim: true, width: 8, height: 8 });
      expect(padded.manifest.fidelity).toMatchObject({ alphaPreserved: true, transparentPadding: true, trimmedSize: { width: 2, height: 2 } });

      const frames = await workshop.sheetSlice({ input: SHEET, outputDir: join(root, 'frames'), cellWidth: 4, cellHeight: 4 });
      expect(frames.outputPaths).toHaveLength(2);
      expect(JSON.parse(await readFile(frames.manifestPath, 'utf8')).fidelity.frames).toEqual([
        { index: 0, x: 0, y: 0, width: 4, height: 4 },
        { index: 1, x: 4, y: 0, width: 4, height: 4 }
      ]);
      const assembled = await workshop.sheetAssemble({ inputs: frames.outputPaths, output: join(root, 'assembled.png'), columns: 2 });
      expect(assembled.manifest.fidelity).toMatchObject({ pixelsMatch: true, dimensions: true });
      const atlas = await workshop.atlasPack({ inputs: [CYAN, ORANGE], output: join(root, 'atlas.png'), maxSize: 16, padding: 1, extrusion: 1, fixedGrid: true });
      expect(atlas.outputPaths).toEqual([join(root, 'atlas.png'), join(root, 'atlas.json')]);
      expect(atlas.manifest.fidelity).toMatchObject({ sourceNamesExactlyOnce: true });
      await expect(workshop.sheetSlice({ input: SHEET, outputDir: join(root, 'frames'), cellWidth: 4, cellHeight: 4 })).rejects.toThrow(/existing output|collision/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('CLI emits a machine-readable manifest and keeps non-zero tool failures actionable', async () => {
    const root = await temp('phase4-cli');
    try {
      const imageMagick = join(root, 'magick');
      const helperRoot = join(root, 'helper');
      await writeFile(imageMagick, 'fixture executable');
      await mkdir(join(helperRoot, 'node_modules', 'free-tex-packer-core'), { recursive: true });
      await writeFile(join(helperRoot, 'node_modules', 'free-tex-packer-core', 'package.json'), JSON.stringify({ version: '0.3.9' }));
      const fake = new FakeImageTools();
      const output = join(root, 'cli-output.png');
      const buffers = ioBuffer();
      const code = await runCli(['image', 'resize-pixel', '--input', TILE, '--output', output, '--scale', '2'], {
        platform: 'win32',
        env: { PATH: '', DSH_IMAGE_MAGICK: imageMagick, DSH_IMAGE_HELPER_ROOT: helperRoot, DSH_HOME: join(root, 'dsh-home') },
        commandRunner: fake.run.bind(fake),
        io: buffers.io
      });
      expect(code).toBe(0);
      expect(JSON.parse(buffers.stdout).operation).toBe('resize-pixel');
      fake.failFor = 'pixel-tile.png';
      const failed = await runCli(['image', 'inspect', '--input', TILE], {
        platform: 'win32',
        env: { PATH: '', DSH_IMAGE_MAGICK: imageMagick, DSH_IMAGE_HELPER_ROOT: helperRoot },
        commandRunner: fake.run.bind(fake),
        io: buffers.io
      });
      expect(failed).toBe(1);
      expect(buffers.stderr).toMatch(/failed|malformed/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('explicit optimization requires pinned oxipng and verifies decoded pixels', async () => {
    const root = await temp('phase4-optimization');
    try {
      const imageMagick = join(root, 'magick');
      const oxipng = join(root, 'oxipng');
      await writeFile(imageMagick, 'fixture executable');
      await writeFile(oxipng, 'fixture executable');
      const noOptimizer = new FakeImageTools();
      await expect(createImageWorkshop(toolchain(root, imageMagick, noOptimizer), { commandRunner: noOptimizer.run.bind(noOptimizer) }).optimizePng({ input: TILE, output: join(root, 'no-optimizer.png') })).rejects.toThrow(/oxipng.*optional/i);
      const fake = new FakeImageTools();
      const result = await createImageWorkshop(toolchain(root, imageMagick, fake, oxipng), { platform: 'win32', env: { PATH: '' }, commandRunner: fake.run.bind(fake) }).optimizePng({ input: TILE, output: join(root, 'optimized.png'), level: 4 });
      expect(result.manifest.fidelity).toMatchObject({ decodedPixelsEqual: true, alphaPreserved: true });
      expect(fake.calls.some((call) => call.command === oxipng)).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Asset Workshop preset deployment', () => {
  test('mounts asset-workshop from Code without adding another MCP service', async () => {
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
      await mkdir(join(root, 'bun-root'), { recursive: true });
      const bun = join(root, 'bun-root', 'bun.exe');
      const dsh = join(root, 'dsh.exe');
      const magick = join(root, 'tools with spaces', 'magick.exe');
      await writeFile(bun, 'fixture');
      await writeFile(dsh, 'fixture');
      await mkdir(join(magick, '..'), { recursive: true });
      await writeFile(magick, 'fixture');
      const fake = new FakeImageTools();
      const deployment = await prepareRpgMakerDeployment({
        platform: 'win32',
        dshHome: join(root, 'dsh-home'),
        runtimeDir: dshRuntime,
        projectPath: project,
        agentPreset: 'asset-workshop',
        imageMagickExecutable: magick,
        sourceRoot: join(process.cwd(), 'presets', 'rpgmaker'),
        jsExecutable: bun,
        dshExecutable: dsh,
        commandRunner: fake.run.bind(fake),
        schemaProbe: async () => ({ tools: ['get_project_info', 'list_records', 'get_record', 'update_record', 'create_record', 'create_event', 'get_event', 'update_event', 'add_dialogue', 'update_map', 'get_map', 'configure_plugin', 'list_plugins', 'validate_project', 'list_backups', 'restore_backup', 'playtest_start', 'playtest_status', 'playtest_log', 'playtest_stop'].map((name) => ({ name, inputSchema: { type: 'object' } })) })
      });
      expect(deployment.agentPreset).toBe('asset-workshop');
      expect(deployment.imageToolchain?.imageMagickVersion).toBe('7.1.2-29');
      expect(await readFile(join(deployment.presetDir, 'skills', 'asset-workshop', 'SKILL.md'), 'utf8')).toContain('resize-pixel');
      const composition = await readFile(deployment.compositionPath, 'utf8');
      expect(composition).toContain('default: asset-workshop');
      expect((composition.match(/id: mcp-rpgmaker-mv/g) ?? [])).toHaveLength(1);
      expect(await readFile(deployment.imageToolchain!.manifestPath, 'utf8')).toContain('7.1.2-29');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
