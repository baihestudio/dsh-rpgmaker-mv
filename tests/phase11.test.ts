import { describe, expect, test } from 'bun:test';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  DSH_BRAND_BUNDLE_RELATIVE,
  DSH_BRAND_PACKAGE,
  DSH_BRAND_VERSION,
  DSH_IMAGEGEN_PACKAGE,
  DSH_IMAGEGEN_VERSION,
  DSH_WEB_PACKAGE,
  DSH_WEB_VERSION,
  ensureManagedWebProfile,
  MANAGED_WEB_PROFILE_PACKAGE_NAMES,
  verifyManagedWebProfile
} from '../src/managed-web-profile';
import { PNPM_VERSION } from '../src/profile';
import { WORKSPACE_MCP_PACKAGE, WORKSPACE_MCP_VERSION, workspaceMcpBundleDigest, workspaceMcpBundleDirFor } from '../src/workspace-mcp';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

async function writePnpmRuntime(runtimeDir: string): Promise<void> {
  const packageDir = join(runtimeDir, 'node_modules', 'pnpm');
  await mkdir(join(packageDir, 'bin'), { recursive: true });
  await mkdir(join(runtimeDir, 'node_modules', '.bin'), { recursive: true });
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ version: PNPM_VERSION, bin: { pnpm: 'bin/pnpm.cjs' } }));
  await writeFile(join(packageDir, 'bin', 'pnpm.cjs'), '/* disposable pnpm */\n');
  await writeFile(join(runtimeDir, 'node_modules', '.bin', 'pnpm.cmd'), '@echo off\r\n');
}

async function writeProfilePackage(
  dshHome: string,
  packageName: string,
  version: string,
  source?: string,
  installedVersion = version,
  includePatch = true
): Promise<void> {
  const profileDir = join(dshHome, 'profiles', 'web');
  const installedDir = join(profileDir, 'node_modules', ...packageName.split('/'));
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    manifest = { name: 'dsh-profile-web', private: true, version: '0.1.0' };
  }
  const dependencies = { ...((manifest.dependencies ?? {}) as Record<string, string>), [packageName]: source ? `file:${source}` : version };
  manifest.dependencies = dependencies;
  await mkdir(dirname(installedDir), { recursive: true });
  await rm(installedDir, { recursive: true, force: true });
  if (source) {
    await cp(source, installedDir, { recursive: true });
  } else {
    await mkdir(join(installedDir, 'lib'), { recursive: true });
    await writeFile(join(installedDir, 'package.json'), JSON.stringify({
      name: packageName,
      version: installedVersion,
      license: 'MIT',
      main: 'lib/index.js',
      ...(includePatch ? { dsh: { bundle: { patch: './cordis.patch.yml' } } } : {})
    }));
    await writeFile(join(installedDir, 'lib', 'index.js'), 'export {};\n');
    if (includePatch) await writeFile(join(installedDir, 'cordis.patch.yml'), '# fixture patch\n');
  }
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function managedRunner(
  dshHome: string,
  calls: string[],
  options: { failPackage?: string; wrongVersion?: string; missingPatch?: string } = {}
) {
  return async (command: string, args: string[], context: { cwd?: string }) => {
    calls.push(`${basename(command)} ${args.join(' ')}`);
    if (args[0] === 'install' && args.includes(`pnpm@${PNPM_VERSION}`)) {
      await writePnpmRuntime(context.cwd!);
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (args[0] !== 'plugin') return { exitCode: 0, stdout: '', stderr: '' };
    const packageSpec = args.at(-1)!;
    if (options.failPackage && packageSpec.includes(options.failPackage)) {
      return { exitCode: 23, stdout: '', stderr: `fixture rejected ${packageSpec}` };
    }
    if (packageSpec === `${DSH_WEB_PACKAGE}@${DSH_WEB_VERSION}`) {
      await writeProfilePackage(dshHome, DSH_WEB_PACKAGE, DSH_WEB_VERSION, undefined, DSH_WEB_VERSION, options.missingPatch !== DSH_WEB_PACKAGE);
    } else if (packageSpec === `${DSH_IMAGEGEN_PACKAGE}@${DSH_IMAGEGEN_VERSION}`) {
      await writeProfilePackage(dshHome, DSH_IMAGEGEN_PACKAGE, DSH_IMAGEGEN_VERSION, undefined, options.wrongVersion, options.missingPatch !== DSH_IMAGEGEN_PACKAGE);
    } else if (packageSpec.startsWith('file:')) {
      const source = packageSpec.slice('file:'.length);
      const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as { name: string; version: string };
      await writeProfilePackage(dshHome, manifest.name, manifest.version, source);
    } else {
      throw new Error(`unexpected managed profile package ${packageSpec}`);
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
}

type TreeSnapshot = Array<[string, string]>;

async function snapshotTree(root: string): Promise<TreeSnapshot> {
  const entries: TreeSnapshot = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    const children = (await readdir(directory)).sort();
    for (const name of children) {
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const absolutePath = join(directory, name);
      const metadata = await lstat(absolutePath);
      if (metadata.isDirectory()) {
        entries.push([relativePath, 'directory']);
        await walk(absolutePath, relativePath);
      } else if (metadata.isSymbolicLink()) {
        entries.push([relativePath, `symlink:${await readlink(absolutePath)}`]);
      } else {
        entries.push([relativePath, `file:${Buffer.from(await readFile(absolutePath)).toString('base64')}`]);
      }
    }
  };
  await walk(root, '');
  return entries;
}

async function rollbackSnapshotNames(dshHome: string): Promise<string[]> {
  return (await readdir(dshHome)).filter((name) => name.startsWith('.managed-web-profile-rollback-')).sort();
}

async function appRoots(root: string) {
  const programRoot = join(root, 'program');
  const mutableRoot = join(root, 'mutable');
  const dshHome = join(mutableRoot, 'state');
  await cp(join(REPOSITORY_ROOT, 'bundle'), join(programRoot, 'bundle'), { recursive: true });
  await mkdir(join(programRoot, 'runtime', 'dsh'), { recursive: true });
  await writeFile(join(programRoot, 'runtime', 'dsh', 'dsh.exe'), 'fixture dsh');
  return {
    programRoot,
    mutableRoot,
    dshHome,
    dshExecutable: join(programRoot, 'runtime', 'dsh', 'dsh.exe'),
    npmExecutable: join(programRoot, 'npm.cmd')
  };
}

function optionsFor(
  roots: Awaited<ReturnType<typeof appRoots>>,
  commandRunner: ReturnType<typeof managedRunner>
) {
  return {
    platform: 'win32',
    env: {},
    ...roots,
    npmExecutable: join(roots.programRoot, 'npm.cmd'),
    commandRunner
  } as const;
}

describe('managed Web profile materialization', () => {
  test('converges to the exact four-package profile and removes stale dependencies', async () => {
    const root = await temp('phase11-managed-profile-exact');
    try {
      const roots = await appRoots(root);
      await mkdir(dirname(roots.npmExecutable), { recursive: true });
      await writeFile(roots.npmExecutable, '@echo off\r\n');
      const calls: string[] = [];
      const first = await ensureManagedWebProfile(optionsFor(roots, managedRunner(roots.dshHome, calls)));
      expect(first.valid).toBe(true);
      expect(first.materialized).toBe(true);
      expect(Object.keys(first.dependencies).sort()).toEqual([...MANAGED_WEB_PROFILE_PACKAGE_NAMES].sort());
      expect(first.bundles).toEqual([...MANAGED_WEB_PROFILE_PACKAGE_NAMES]);
      expect(calls.filter((call) => call.includes(`pnpm@${PNPM_VERSION}`))).toHaveLength(1);
      expect(await rollbackSnapshotNames(roots.dshHome)).toEqual([]);

      const profileManifestPath = join(roots.dshHome, 'profiles', 'web', 'package.json');
      const staleManifest = JSON.parse(await readFile(profileManifestPath, 'utf8')) as { dependencies: Record<string, string> };
      staleManifest.dependencies['@tta-lab/dsh-web'] = '3.1.0';
      await writeFile(profileManifestPath, `${JSON.stringify(staleManifest, null, 2)}\n`);
      const secondCalls: string[] = [];
      const second = await ensureManagedWebProfile(optionsFor(roots, managedRunner(roots.dshHome, secondCalls)));
      expect(second.valid).toBe(true);
      expect(second.materialized).toBe(true);
      expect(Object.keys(second.dependencies).sort()).toEqual([...MANAGED_WEB_PROFILE_PACKAGE_NAMES].sort());
      expect(second.dependencies['@tta-lab/dsh-web']).toBeUndefined();
      expect(second.bundles).toEqual([...MANAGED_WEB_PROFILE_PACKAGE_NAMES]);
      expect(secondCalls.filter((call) => call.startsWith('dsh.exe plugin --profile web add'))).toHaveLength(4);
      expect(await rollbackSnapshotNames(roots.dshHome)).toEqual([]);
      expect(second.packages.map((pkg) => `${pkg.packageName}@${pkg.installedVersion}`)).toEqual([
        `${DSH_WEB_PACKAGE}@${DSH_WEB_VERSION}`,
        `${DSH_IMAGEGEN_PACKAGE}@${DSH_IMAGEGEN_VERSION}`,
        `${DSH_BRAND_PACKAGE}@${DSH_BRAND_VERSION}`,
        `${WORKSPACE_MCP_PACKAGE}@${WORKSPACE_MCP_VERSION}`
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('restores the complete prior profile after a package-addition failure and leaves mutable state intact', async () => {
    const root = await temp('phase11-managed-profile-rollback');
    try {
      const roots = await appRoots(root);
      await writeFile(roots.npmExecutable, '@echo off\r\n');
      const initialCalls: string[] = [];
      await ensureManagedWebProfile(optionsFor(roots, managedRunner(roots.dshHome, initialCalls)));
      const profileDir = join(roots.dshHome, 'profiles', 'web');
      const manifestPath = join(profileDir, 'package.json');
      const priorManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { dependencies: Record<string, string> };
      priorManifest.dependencies['@baihestudio/retired-profile-plugin'] = '9.9.9';
      await writeFile(manifestPath, `${JSON.stringify(priorManifest, null, 2)}\n`);
      const marker = join(profileDir, 'prior-profile-marker.txt');
      await writeFile(marker, 'prior profile remains recoverable\n');
      const mutableMarker = join(roots.mutableRoot, 'keep-user-state.txt');
      await writeFile(mutableMarker, 'mutable state must survive profile repair\n');
      const workspaceBundleDir = workspaceMcpBundleDirFor({ dshHome: roots.dshHome });
      const priorProfileTree = await snapshotTree(profileDir);
      const priorWorkspaceTree = await snapshotTree(workspaceBundleDir);
      const priorWorkspaceDigest = await workspaceMcpBundleDigest(workspaceBundleDir);

      const failingCalls: string[] = [];
      await expect(ensureManagedWebProfile(optionsFor(
        roots,
        managedRunner(roots.dshHome, failingCalls, { failPackage: DSH_IMAGEGEN_PACKAGE })
      ))).rejects.toThrow(/dsh-imagegen.*prior managed Web profile was restored/i);

      const restoredManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { dependencies: Record<string, string> };
      expect(restoredManifest.dependencies).toEqual(priorManifest.dependencies);
      expect(await snapshotTree(profileDir)).toEqual(priorProfileTree);
      expect(await snapshotTree(workspaceBundleDir)).toEqual(priorWorkspaceTree);
      expect(await workspaceMcpBundleDigest(workspaceBundleDir)).toBe(priorWorkspaceDigest);
      expect(await rollbackSnapshotNames(roots.dshHome)).toEqual([]);
      expect(await readFile(marker, 'utf8')).toContain('prior profile remains recoverable');
      expect(await readFile(mutableMarker, 'utf8')).toContain('mutable state must survive');
      expect(await stat(join(profileDir, 'node_modules', ...DSH_WEB_PACKAGE.split('/')))).toBeTruthy();
      const verification = await verifyManagedWebProfile(optionsFor(roots, managedRunner(roots.dshHome, [])));
      expect(verification.valid).toBe(false);
      expect(verification.errors.join(' ')).toContain('@baihestudio/retired-profile-plugin');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects and repairs an installed package whose declared patch is missing', async () => {
    const root = await temp('phase11-managed-profile-missing-patch');
    try {
      const roots = await appRoots(root);
      await writeFile(roots.npmExecutable, '@echo off\r\n');
      await ensureManagedWebProfile(optionsFor(roots, managedRunner(roots.dshHome, [])));
      const patchPath = join(roots.dshHome, 'profiles', 'web', 'node_modules', '@lamplitisles', 'dsh-imagegen', 'cordis.patch.yml');
      await rm(patchPath);

      const broken = await verifyManagedWebProfile(optionsFor(roots, managedRunner(roots.dshHome, [])));
      expect(broken.valid).toBe(false);
      expect(broken.errors.join(' ')).toMatch(/installed profile package .*dsh\.bundle\.patch .*was not found/i);

      const repaired = await ensureManagedWebProfile(optionsFor(roots, managedRunner(roots.dshHome, [])));
      expect(repaired.valid).toBe(true);
      expect(repaired.materialized).toBe(true);
      await expect(stat(patchPath)).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('serializes concurrent ensure calls through the harness operation lock', async () => {
    const root = await temp('phase11-managed-profile-concurrent');
    try {
      const roots = await appRoots(root);
      await writeFile(roots.npmExecutable, '@echo off\r\n');
      const calls: string[] = [];
      let activePluginAdds = 0;
      let maxActivePluginAdds = 0;
      const baseRunner = managedRunner(roots.dshHome, calls);
      const runner = async (command: string, args: string[], context: { cwd?: string }) => {
        if (args[0] === 'plugin') {
          activePluginAdds += 1;
          maxActivePluginAdds = Math.max(maxActivePluginAdds, activePluginAdds);
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        }
        try {
          return await baseRunner(command, args, context);
        } finally {
          if (args[0] === 'plugin') activePluginAdds -= 1;
        }
      };

      const [first, second] = await Promise.all([
        ensureManagedWebProfile(optionsFor(roots, runner)),
        ensureManagedWebProfile(optionsFor(roots, runner))
      ]);
      expect(first.valid).toBe(true);
      expect(second.valid).toBe(true);
      expect([first.materialized, second.materialized].filter(Boolean)).toHaveLength(1);
      expect(maxActivePluginAdds).toBe(1);
      expect(calls.filter((call) => call.startsWith('dsh.exe plugin --profile web add'))).toHaveLength(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('restores an absent active profile when final verification rejects an installed package', async () => {
    const root = await temp('phase11-managed-profile-final-verify');
    try {
      const roots = await appRoots(root);
      await writeFile(roots.npmExecutable, '@echo off\r\n');
      const calls: string[] = [];
      await expect(ensureManagedWebProfile(optionsFor(
        roots,
        managedRunner(roots.dshHome, calls, { wrongVersion: '0.0.0' })
      ))).rejects.toThrow(/materialization completed but verification failed.*prior managed Web profile was restored/i);
      await expect(stat(join(roots.dshHome, 'profiles', 'web'))).rejects.toThrow();
      await expect(stat(workspaceMcpBundleDirFor({ dshHome: roots.dshHome }))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('restores an absent active profile when final verification rejects a missing package patch', async () => {
    const root = await temp('phase11-managed-profile-final-missing-patch');
    try {
      const roots = await appRoots(root);
      await writeFile(roots.npmExecutable, '@echo off\r\n');
      const calls: string[] = [];
      await expect(ensureManagedWebProfile(optionsFor(
        roots,
        managedRunner(roots.dshHome, calls, { missingPatch: DSH_IMAGEGEN_PACKAGE })
      ))).rejects.toThrow(/materialization completed but verification failed:.*dsh\.bundle\.patch.*prior managed Web profile was restored/i);
      await expect(stat(join(roots.dshHome, 'profiles', 'web'))).rejects.toThrow();
      await expect(stat(workspaceMcpBundleDirFor({ dshHome: roots.dshHome }))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
