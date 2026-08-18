import { describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import {
  IMAGE_WORKSHOP_BUNDLE_RELATIVE,
  IMAGE_WORKSHOP_PLUGIN_PACKAGE,
  IMAGE_WORKSHOP_PLUGIN_ROW_ID,
  IMAGE_WORKSHOP_PLUGIN_SHA256,
  IMAGE_WORKSHOP_PLUGIN_VERSION,
  IMAGE_WORKSHOP_TOOL_NAMES,
  imageWorkshopBundleDigest,
  prepareImageWorkshopPlugin,
  verifyImageWorkshopPlugin
} from '../src/image-plugin';
import { installPreset } from '../src/rpgmaker';
import { buildReleaseZip, inspectReleaseZip } from '../src/release-gate';
import { validateRelativePath, resolveWorkspacePath } from '../bundle/dsh-image-workshop/lib/workspace.js';
import { createImageInspectTool, createImageResizePixelTool } from '../bundle/dsh-image-workshop/lib/tools.js';
import { clearWorkshopRunner, setWorkshopRunner } from '../bundle/dsh-image-workshop/lib/workshop-client.js';

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

const BUNDLE_SOURCE = join(process.cwd(), 'bundle', 'dsh-image-workshop');

async function copyBundle(destination: string): Promise<void> {
  await cp(BUNDLE_SOURCE, destination, { recursive: true });
}

async function writeInstalledProfile(dshHome: string, dependency?: string, bundles?: string[]): Promise<string> {
  const profile = join(dshHome, 'profiles', 'web');
  await mkdir(join(profile, 'node_modules'), { recursive: true });
  const manifest: Record<string, unknown> = { name: 'dsh-profile-web', private: true, version: '0.1.0' };
  if (dependency) manifest.dependencies = { [IMAGE_WORKSHOP_PLUGIN_PACKAGE]: dependency };
  if (bundles) manifest.dsh = { profile: { bundles } };
  await writeFile(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\nimporters:\n  .:\n    dependencies:\n      __placeholder__:\n        specifier: "0.0.0"\n        version: 0.0.0\n');
  return profile;
}

/** Write a profile whose installed node_modules entry links to the app-owned bundle, mirroring `plugin add file:`. */
async function writeInstalledImagePlugin(dshHome: string, bundleTarget: string): Promise<string> {
  const profile = join(dshHome, 'profiles', 'web');
  const installedDir = join(profile, 'node_modules', IMAGE_WORKSHOP_PLUGIN_PACKAGE);
  await mkdir(dirname(installedDir), { recursive: true });
  await rm(installedDir, { recursive: true, force: true });
  await symlink(bundleTarget, installedDir, 'dir');
  const manifest: Record<string, unknown> = {
    name: 'dsh-profile-web',
    private: true,
    version: '0.1.0',
    dependencies: { [IMAGE_WORKSHOP_PLUGIN_PACKAGE]: `file:${bundleTarget}` }
  };
  await writeFile(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\nimporters:\n  .:\n    dependencies:\n      __placeholder__:\n        specifier: "0.0.0"\n        version: 0.0.0\n');
  return profile;
}

function agentExec(workspace: string) {
  return { agent: { session: { header: { cwd: workspace } } } };
}

describe('image workspace path fencing', () => {
  test('rejects absolute, traversal, drive, and root paths by shape', () => {
    expect(() => validateRelativePath('/abs/path.png', 'Input')).toThrow(/project-relative/);
    expect(() => validateRelativePath('C:\\x\\y.png', 'Input')).toThrow(/project-relative/);
    expect(() => validateRelativePath('\\server\\share.png', 'Input')).toThrow(/project-relative/);
    expect(() => validateRelativePath('../escape.png', 'Input')).toThrow(/traversal/);
    expect(() => validateRelativePath('a/../../escape.png', 'Input')).toThrow(/traversal/);
    expect(() => validateRelativePath('', 'Input')).toThrow(/non-empty/);
    expect(() => validateRelativePath('.', 'Input')).toThrow(/workspace root/);
    expect(validateRelativePath('sprites/hero.png')).toBe('sprites/hero.png');
    expect(validateRelativePath('素材 含 空格/角色.png')).toBe('素材 含 空格/角色.png');
  });

  test('resolves inside the workspace and rejects symlink/junction escapes', async () => {
    const root = await temp('fence-resolve');
    try {
      const workspace = join(root, 'workspace');
      await mkdir(join(workspace, 'sprites'), { recursive: true });
      await writeFile(join(workspace, 'sprites', 'hero.png'), 'png');
      await writeFile(join(root, 'outside.png'), 'outside');
      await symlink(join(root, 'outside.png'), join(workspace, 'link.png'));
      await symlink(root, join(workspace, 'outdir'), 'dir');

      expect(await resolveWorkspacePath(workspace, 'sprites/hero.png')).toBe(join(workspace, 'sprites', 'hero.png'));
      await expect(resolveWorkspacePath(workspace, '../outside.png')).rejects.toThrow(/traversal|workspace/);
      await expect(resolveWorkspacePath(workspace, '/abs.png')).rejects.toThrow(/project-relative/);
      await expect(resolveWorkspacePath(workspace, 'link.png')).rejects.toThrow(/symlink or junction/);
      await expect(resolveWorkspacePath(workspace, 'outdir/new.png', { forOutput: true })).rejects.toThrow(/symlink or junction/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('image tool adapter seam', () => {
  test('image_inspect maps structured args and returns canonical JSON plus a concise render', async () => {
    const root = await temp('adapter-inspect');
    try {
      const workspace = join(root, 'workspace');
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, 'hero.png'), 'png');
      const calls: Array<{ bun: string; args: string[] }> = [];
      setWorkshopRunner(async (bun, args) => {
        calls.push({ bun, args });
        const input = args[args.length - 1];
        return JSON.stringify({ path: input, width: 32, height: 32, format: 'PNG', channels: 'srgb', hasAlpha: false, opaque: true, bytes: 10, sha256: 'abc123' });
      });
      try {
        const tool = createImageInspectTool();
        const result = await tool.execute({ input: 'hero.png' }, agentExec(workspace));
        expect(result.width).toBe(32);
        expect(result.sha256).toBe('abc123');
        expect(result.path).toBe('hero.png');
        expect(calls).toHaveLength(1);
        expect(calls[0].args[0]).toBe('inspect');
        expect(calls[0].args.slice(-2)).toEqual(['--input', join(workspace, 'hero.png')]);
        expect(tool.output.render({ input: 'hero.png' }, result)[0].text).toContain('hero.png: 32x32');
        await expect(tool.execute({ input: 'missing.png' }, agentExec(workspace))).rejects.toThrow(/does not exist/);
        await expect(tool.execute({ input: '../outside.png' }, agentExec(workspace))).rejects.toThrow(/traversal/);
      } finally {
        clearWorkshopRunner();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('image_resize_pixel maps scale, rejects existing outputs and invalid params', async () => {
    const root = await temp('adapter-resize');
    try {
      const workspace = join(root, 'workspace');
      await mkdir(workspace, { recursive: true });
      await writeFile(join(workspace, 'hero.png'), 'png');
      const calls: Array<{ args: string[] }> = [];
      setWorkshopRunner(async (_bun, args) => {
        calls.push({ args });
        const output = args[args.indexOf('--output') + 1];
        return JSON.stringify({ schemaVersion: 2, operation: 'resize-pixel', toolchain: {}, inputs: [], outputs: [{ kind: 'image', path: output, width: 96, height: 96 }], options: { scale: 3 }, fidelity: { dimensions: true }, verificationLevel: 'decoded-pixels', lossless: true });
      });
      try {
        const tool = createImageResizePixelTool();
        const result = await tool.execute({ input: 'hero.png', output: 'big.png', scale: 3 }, agentExec(workspace));
        expect(result.operation).toBe('resize-pixel');
        expect(result.outputPaths).toEqual(['big.png']);
        expect(result.manifestPath).toBe('big.png.manifest.json');
        expect(calls[0].args[0]).toBe('resize-pixel');
        expect(calls[0].args).toEqual(['resize-pixel', '--input', join(workspace, 'hero.png'), '--output', join(workspace, 'big.png'), '--scale', '3']);
        expect(tool.output.render({ input: 'hero.png', output: 'big.png', scale: 3 }, result)[0].text).toContain('resize-pixel succeeded');
        expect(tool.output.render({ input: 'hero.png', output: 'big.png', scale: 3 }, result)[0].text).toContain('big.png');

        await writeFile(join(workspace, 'exists.png'), 'x');
        await expect(tool.execute({ input: 'hero.png', output: 'exists.png', scale: 2 }, agentExec(workspace))).rejects.toThrow(/already exists/);
        await expect(tool.execute({ input: 'hero.png', output: 'x2.png', scale: 2, width: 4, height: 4 }, agentExec(workspace))).rejects.toThrow(/not both/);
        await expect(tool.execute({ input: 'hero.png', output: 'x2.png' }, agentExec(workspace))).rejects.toThrow(/requires scale/);
        await expect(tool.execute({ input: 'missing.png', output: 'x2.png', scale: 2 }, agentExec(workspace))).rejects.toThrow(/does not exist/);
        await expect(tool.execute({ input: '/etc/passwd', output: 'x2.png', scale: 2 }, agentExec(workspace))).rejects.toThrow(/project-relative/);
        await expect(tool.execute({ input: 'hero.png', output: 'x2.png', scale: 2 }, {})).rejects.toThrow(/workspace cwd/);
        expect(calls).toHaveLength(1);
      } finally {
        clearWorkshopRunner();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('app-owned image tool plugin installation', () => {
  test('installs the local bundle once and reuses it idempotently', async () => {
    const root = await temp('plugin-install');
    try {
      const programRoot = join(root, 'program');
      const dshHome = join(root, 'dsh-home');
      const runtimeDir = join(programRoot, 'runtime', 'dsh');
      const pnpm = join(root, 'pnpm.exe');
      await mkdir(join(programRoot, 'bundle'), { recursive: true });
      await copyBundle(join(programRoot, 'bundle', 'dsh-image-workshop'));
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(pnpm, 'fixture');
      const dsh = join(runtimeDir, 'dsh.exe');
      await writeFile(dsh, 'fixture');
      let pluginCalls = 0;
      const runner = async (command: string, args: string[]) => {
        expect(command).toBe(dsh);
        if (args[0] === 'plugin') {
          pluginCalls += 1;
          const local = args.find((value) => value.startsWith('file:'));
          expect(local).toBeDefined();
          await writeInstalledImagePlugin(dshHome, local!.slice('file:'.length));
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        throw new Error(`unexpected runner call: ${args.join(' ')}`);
      };
      const options = { platform: 'win32', dshHome, programRoot, runtimeDir, dshExecutable: dsh, pnpmExecutable: pnpm, commandRunner: runner } as const;
      const first = await prepareImageWorkshopPlugin(options);
      expect(first.valid).toBe(true);
      expect(first.packageVersion).toBe(IMAGE_WORKSHOP_PLUGIN_VERSION);
      expect(first.bundleOccurrences).toBe(0);
      expect(first.packageDir).toBe(await realpath(join(programRoot, IMAGE_WORKSHOP_BUNDLE_RELATIVE)));
      expect(pluginCalls).toBe(1);

      const second = await prepareImageWorkshopPlugin(options);
      expect(second.valid).toBe(true);
      expect(pluginCalls).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('repairs a broken or misdirected installed link instead of accepting it', async () => {
    const root = await temp('plugin-repair');
    try {
      const programRoot = join(root, 'program');
      const dshHome = join(root, 'dsh-home');
      const runtimeDir = join(programRoot, 'runtime', 'dsh');
      const pnpm = join(root, 'pnpm.exe');
      await mkdir(join(programRoot, 'bundle'), { recursive: true });
      await copyBundle(join(programRoot, 'bundle', 'dsh-image-workshop'));
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(pnpm, 'fixture');
      const dsh = join(runtimeDir, 'dsh.exe');
      await writeFile(dsh, 'fixture');
      const options = { platform: 'win32', dshHome, programRoot, runtimeDir, dshExecutable: dsh, pnpmExecutable: pnpm } as const;
      const target = join(programRoot, IMAGE_WORKSHOP_BUNDLE_RELATIVE);

      // A manifest entry with no installed node_modules copy must fail verification.
      await writeInstalledProfile(dshHome, `file:${target}`);
      const missing = await verifyImageWorkshopPlugin({ ...options, bundleDir: target });
      expect(missing.valid).toBe(false);
      expect(missing.errors.join(' ')).toMatch(/installed profile package .* was not found/);

      // A link pointing outside the app-owned program root must fail verification.
      const external = join(root, 'external');
      await copyBundle(external);
      const profile = join(dshHome, 'profiles', 'web');
      const installedDir = join(profile, 'node_modules', IMAGE_WORKSHOP_PLUGIN_PACKAGE);
      await mkdir(dirname(installedDir), { recursive: true });
      await symlink(external, installedDir, 'dir');
      const misdirected = await verifyImageWorkshopPlugin({ ...options, bundleDir: target });
      expect(misdirected.valid).toBe(false);
      expect(misdirected.errors.join(' ')).toMatch(/does not resolve to the app-owned program root/);

      // Repair re-links: a fresh runner that performs a real `file:` link makes it valid.
      let pluginCalls = 0;
      const runner = async (command: string, args: string[]) => {
        expect(command).toBe(dsh);
        if (args[0] === 'plugin') {
          pluginCalls += 1;
          const local = args.find((value) => value.startsWith('file:'));
          expect(local).toBeDefined();
          await writeInstalledImagePlugin(dshHome, local!.slice('file:'.length));
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        throw new Error(`unexpected runner call: ${args.join(' ')}`);
      };
      const repaired = await prepareImageWorkshopPlugin({ ...options, commandRunner: runner });
      expect(repaired.valid).toBe(true);
      expect(repaired.packageDir).toBe(await realpath(target));
      expect(pluginCalls).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects a tampered bundle, a non-owned path, and a globally mounted layer', async () => {
    const root = await temp('plugin-verify');
    try {
      const programRoot = join(root, 'program');
      const dshHome = join(root, 'dsh-home');
      await mkdir(programRoot, { recursive: true });
      const bundleDir = join(programRoot, 'bundle', 'dsh-image-workshop');
      await copyBundle(bundleDir);
      await writeFile(join(bundleDir, 'lib', 'index.js'), await readFile(join(bundleDir, 'lib', 'index.js'), 'utf8').then((text) => `${text}\n`));

      const tampered = await verifyImageWorkshopPlugin({ platform: 'win32', dshHome, programRoot, bundleDir });
      expect(tampered.valid).toBe(false);
      expect(tampered.errors.join(' ')).toMatch(/release hash/);

      await writeInstalledProfile(dshHome, `file:${bundleDir}`, [IMAGE_WORKSHOP_PLUGIN_PACKAGE]);
      const global = await verifyImageWorkshopPlugin({ platform: 'win32', dshHome, programRoot, bundleDir });
      expect(global.errors.join(' ')).toMatch(/Agent-scoped|global/);

      const external = join(root, 'external');
      await copyBundle(external);
      const outside = await verifyImageWorkshopPlugin({ platform: 'win32', dshHome, programRoot, bundleDir: external });
      expect(outside.ownedPath).toBe(false);
      expect(outside.valid).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('accepts a copied install at the canonical profile path with a matching hash', async () => {
    const root = await temp('plugin-copied');
    try {
      const programRoot = join(root, 'program');
      const dshHome = join(root, 'dsh-home');
      const bundleDir = join(programRoot, IMAGE_WORKSHOP_BUNDLE_RELATIVE);
      await mkdir(bundleDir, { recursive: true });
      await copyBundle(bundleDir);
      const profile = join(dshHome, 'profiles', 'web');
      const installedDir = join(profile, 'node_modules', IMAGE_WORKSHOP_PLUGIN_PACKAGE);
      await mkdir(dirname(installedDir), { recursive: true });
      // Real DSH rc.7 packs a file: dependency into the profile node_modules
      // as a plain directory copy rather than a symlink. Use a relative spec
      // to cover resolution against the profile directory.
      await cp(bundleDir, installedDir, { recursive: true });
      const manifest: Record<string, unknown> = {
        name: 'dsh-profile-web', private: true, version: '0.1.0',
        dependencies: { [IMAGE_WORKSHOP_PLUGIN_PACKAGE]: `file:${relative(profile, bundleDir)}` }
      };
      await writeFile(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\nimporters:\n  .:\n    dependencies:\n      __placeholder__:\n        specifier: "0.0.0"\n        version: 0.0.0\n');
      const verification = await verifyImageWorkshopPlugin({ platform: 'win32', dshHome, programRoot, bundleDir });
      expect(verification.valid).toBe(true);
      expect(verification.packageDir).toBe(await realpath(installedDir));
      expect(verification.profileDependency).toBe(`file:${relative(profile, bundleDir)}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects a dependency spec that does not resolve to the app-owned bundle', async () => {
    const root = await temp('plugin-misdirected-dep');
    try {
      const programRoot = join(root, 'program');
      const dshHome = join(root, 'dsh-home');
      const bundleDir = join(programRoot, IMAGE_WORKSHOP_BUNDLE_RELATIVE);
      await mkdir(bundleDir, { recursive: true });
      await copyBundle(bundleDir);
      // A valid copy at the canonical profile path, but the profile dependency
      // points at a different (still file:) location, so the install is not the
      // app-owned bundle and must be rejected so repair can relink it.
      const elsewhere = join(root, 'elsewhere');
      await copyBundle(elsewhere);
      const profile = join(dshHome, 'profiles', 'web');
      const installedDir = join(profile, 'node_modules', IMAGE_WORKSHOP_PLUGIN_PACKAGE);
      await mkdir(dirname(installedDir), { recursive: true });
      await cp(bundleDir, installedDir, { recursive: true });
      const manifest: Record<string, unknown> = {
        name: 'dsh-profile-web', private: true, version: '0.1.0',
        dependencies: { [IMAGE_WORKSHOP_PLUGIN_PACKAGE]: `file:${elsewhere}` }
      };
      await writeFile(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      await writeFile(join(profile, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\nimporters:\n  .:\n    dependencies:\n      __placeholder__:\n        specifier: "0.0.0"\n        version: 0.0.0\n');
      const verification = await verifyImageWorkshopPlugin({ platform: 'win32', dshHome, programRoot, bundleDir });
      expect(verification.valid).toBe(false);
      expect(verification.errors.join(' ')).toMatch(/does not resolve to the app-owned local bundle/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('restores the profile when the local link fails, including the plugin node_modules entry', async () => {
    const root = await temp('plugin-rollback');
    try {
      const programRoot = join(root, 'program');
      const dshHome = join(root, 'dsh-home');
      const runtimeDir = join(programRoot, 'runtime', 'dsh');
      const pnpm = join(root, 'pnpm.exe');
      const profile = await writeInstalledProfile(dshHome);
      await mkdir(runtimeDir, { recursive: true });
      await writeFile(pnpm, 'fixture');
      const dsh = join(runtimeDir, 'dsh.exe');
      await writeFile(dsh, 'fixture');
      const before = await readFile(join(profile, 'package.json'), 'utf8');
      const installedDir = join(profile, 'node_modules', IMAGE_WORKSHOP_PLUGIN_PACKAGE);
      // Simulate a partial `plugin add` that mutated the profile and created the
      // plugin's own node_modules entry before the manager command failed.
      const runner = async () => {
        await writeFile(join(profile, 'package.json'), `${JSON.stringify({
          name: 'dsh-profile-web', private: true, version: '0.1.0',
          dependencies: { [IMAGE_WORKSHOP_PLUGIN_PACKAGE]: `file:${join(programRoot, IMAGE_WORKSHOP_BUNDLE_RELATIVE)}` }
        }, null, 2)}\n`);
        await mkdir(installedDir, { recursive: true });
        await writeFile(join(installedDir, 'package.json'), '{"name":"partial"}\n');
        return { exitCode: 1, stdout: '', stderr: 'synthetic plugin add failure' };
      };
      await expect(prepareImageWorkshopPlugin({
        platform: 'win32', dshHome, programRoot, runtimeDir, dshExecutable: dsh, pnpmExecutable: pnpm, commandRunner: runner
      })).rejects.toThrow(/plugin manager|failed/);
      const after = await readFile(join(profile, 'package.json'), 'utf8');
      expect(after).toBe(before);
      expect(after).not.toContain(IMAGE_WORKSHOP_PLUGIN_PACKAGE);
      await expect(stat(installedDir)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('asset-workshop preset composition', () => {
  const CODE = "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: generic Code persona\n- id: code-tool\n  name: fake-code-tool\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n";

  async function sourceWith(root: string, overlay: string): Promise<string> {
    const source = join(root, 'preset-source');
    await mkdir(join(source, 'skills', 'asset-workshop'), { recursive: true });
    await writeFile(join(source, 'preset.yml'), 'name: 游戏图片素材助手\ndescription: 测试\norder: 2\n');
    await writeFile(join(source, 'agent.cordis.yml'), overlay);
    return source;
  }

  test('composes the asset preset with exactly one persona and one app-owned plugin row', async () => {
    const root = await temp('preset-asset');
    try {
      const runtime = join(root, 'runtime');
      const code = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code', 'agent.cordis.yml');
      await mkdir(dirname(code), { recursive: true });
      await writeFile(code, CODE);
      const source = await sourceWith(root, `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: asset persona\n- id: ${IMAGE_WORKSHOP_PLUGIN_ROW_ID}\n  name: '${IMAGE_WORKSHOP_PLUGIN_PACKAGE}'\n`);
      const dshHome = join(root, 'dsh-home');
      const { presetDir } = await installPreset(source, dshHome, code, 'asset-workshop');
      const composed = await readFile(join(presetDir, 'agent.cordis.yml'), 'utf8');
      expect((composed.match(/^- id: persona$/gm) ?? [])).toHaveLength(1);
      expect(composed).toContain(`id: ${IMAGE_WORKSHOP_PLUGIN_ROW_ID}`);
      expect(composed).toContain(IMAGE_WORKSHOP_PLUGIN_PACKAGE);
      expect(composed).toContain('code-tool');
      expect(composed).toContain('customSkillDirs');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects the plugin row in other presets and duplicate plugin rows', async () => {
    const root = await temp('preset-reject');
    try {
      const runtime = join(root, 'runtime');
      const code = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets', 'code', 'agent.cordis.yml');
      await mkdir(dirname(code), { recursive: true });
      await writeFile(code, CODE);
      const dshHome = join(root, 'dsh-home');
      const pluginOverlay = `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: x\n- id: ${IMAGE_WORKSHOP_PLUGIN_ROW_ID}\n  name: '${IMAGE_WORKSHOP_PLUGIN_PACKAGE}'\n`;
      const rpgmakerSource = await sourceWith(root, pluginOverlay);
      await expect(installPreset(rpgmakerSource, dshHome, code, 'rpgmaker')).rejects.toThrow(/must not mount the image tool plugin/);

      const duplicate = await sourceWith(root, `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: x\n- id: ${IMAGE_WORKSHOP_PLUGIN_ROW_ID}\n  name: '${IMAGE_WORKSHOP_PLUGIN_PACKAGE}'\n- id: ${IMAGE_WORKSHOP_PLUGIN_ROW_ID}\n  name: '${IMAGE_WORKSHOP_PLUGIN_PACKAGE}'\n`);
      await expect(installPreset(duplicate, dshHome, code, 'asset-workshop')).rejects.toThrow(/must not duplicate/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('release bundle', () => {
  test('ships the prebuilt bundle in the ZIP and pins its release hash', async () => {
    const root = await temp('zip-bundle');
    try {
      const zip = join(root, 'DSH-RPGMaker-MV-Windows.zip');
      const archive = await buildReleaseZip({ sourceRoot: process.cwd(), outputZip: zip, platform: process.platform });
      const inspection = await inspectReleaseZip({ zipPath: archive, platform: process.platform });
      expect(inspection.valid).toBe(true);
      expect(inspection.entries).toContain('bundle/dsh-image-workshop/package.json');
      expect(inspection.entries).toContain('bundle/dsh-image-workshop/lib/index.js');
      expect(await imageWorkshopBundleDigest(BUNDLE_SOURCE)).toBe(IMAGE_WORKSHOP_PLUGIN_SHA256);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('exposes exactly the two Ticket 02 tools', () => {
    expect(IMAGE_WORKSHOP_TOOL_NAMES).toEqual(['image_inspect', 'image_resize_pixel']);
  });
});
