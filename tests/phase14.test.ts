import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DESKTOP_HOST_MANIFEST_NAME,
  DESKTOP_HOST_MANIFEST_RELATIVE,
  DESKTOP_HOST_PROVENANCE_SCHEMA_VERSION,
  DESKTOP_HOST_SIDECAR_RELATIVE,
  DESKTOP_HOST_SUPERVISOR_RELATIVE,
  ELECTROBUN_BUN_VERSION,
  ELECTROBUN_HOST_COMMIT,
  ELECTROBUN_PRODUCT_IDENTIFIER,
  ELECTROBUN_PRODUCT_VERSION,
  copyDesktopHostPayload,
  verifyDesktopHostPayload,
} from '../src/desktop-host';
import { buildReleaseZip, inspectReleaseZip, installWindowsRelease, ReleaseGateError } from '../src/release-gate';
import {
  RunningAgentCloseDeclinedError,
  confirmAndStopOwnedAgent,
  findOwnedAgent,
  parseWindowsProcessTable,
  stopWindowsProcessTree,
} from '../src/install-lifecycle';
import { DSH_NPM_INTEGRITY, DSH_PACKAGE_NAME, DSH_VERSION, PROGRAM_OWNER, PROGRAM_OWNERSHIP_FILE, PRODUCT_NAME } from '../src/config';
import { DSH_RUNTIME_PEER_DEPENDENCIES } from '../src/bootstrap';

async function temp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

function runBunScript(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['run', ...args], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

async function makeHost(root: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const payload = join(root, 'host-payload');
  const launchTarget = 'app/RPG Maker Agent.exe';
  await mkdir(join(payload, 'app'), { recursive: true });
  await mkdir(dirname(join(payload, DESKTOP_HOST_SIDECAR_RELATIVE)), { recursive: true });
  await mkdir(dirname(join(payload, DESKTOP_HOST_SUPERVISOR_RELATIVE)), { recursive: true });
  const sidecarText = 'sidecar fixture';
  await writeFile(join(payload, launchTarget), 'native host fixture');
  await writeFile(join(payload, DESKTOP_HOST_SIDECAR_RELATIVE), sidecarText);
  await writeFile(join(payload, DESKTOP_HOST_SUPERVISOR_RELATIVE), 'supervisor fixture');
  const adapterSource = await readFile(join(process.cwd(), 'src', 'electrobun-sidecar.ts'), 'utf8');
  const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
  await writeFile(join(payload, DESKTOP_HOST_MANIFEST_NAME), JSON.stringify({
    format: 1,
    owner: PROGRAM_OWNER,
    product: PRODUCT_NAME,
    hostCommit: ELECTROBUN_HOST_COMMIT,
    bunVersion: ELECTROBUN_BUN_VERSION,
    productVersion: ELECTROBUN_PRODUCT_VERSION,
    app: { identifier: ELECTROBUN_PRODUCT_IDENTIFIER },
    launchTarget,
    sidecarEntrypoint: DESKTOP_HOST_SIDECAR_RELATIVE,
    supervisorExecutable: DESKTOP_HOST_SUPERVISOR_RELATIVE,
    sidecarProvenance: {
      schemaVersion: DESKTOP_HOST_PROVENANCE_SCHEMA_VERSION,
      adapterSourceSha256: digest(adapterSource),
      sidecarSha256: digest(sidecarText),
    },
    ...overrides,
  }, null, 2));
  return payload;
}

async function makeMinimalDshRuntime(runtime: string): Promise<void> {
  const packageDir = join(runtime, 'node_modules', '@deepseek-ai', 'dsh');
  await mkdir(join(packageDir, 'lib'), { recursive: true });
  await mkdir(join(packageDir, 'config', 'agent-presets', 'code'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', '.bin'), { recursive: true });
  await mkdir(join(runtime, 'node_modules', 'koffi'), { recursive: true });
  const dependencies = { [DSH_PACKAGE_NAME]: DSH_VERSION, ...DSH_RUNTIME_PEER_DEPENDENCIES };
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ dependencies }));
  await writeFile(join(runtime, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
    '': { dependencies },
    [`node_modules/${DSH_PACKAGE_NAME}`]: { version: DSH_VERSION, integrity: DSH_NPM_INTEGRITY },
    ...Object.fromEntries(Object.entries(DSH_RUNTIME_PEER_DEPENDENCIES).map(([name, version]) => [`node_modules/${name}`, { version }]))
  } }));
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ version: DSH_VERSION, bin: { dsh: 'lib/bin.js' } }));
  await writeFile(join(packageDir, 'lib', 'bin.js'), 'fixture');
  await writeFile(join(packageDir, 'config', 'agent-presets', 'code', 'agent.cordis.yml'), "- id: persona\n  name: fixture persona\n- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'\n");
  await writeFile(join(runtime, 'node_modules', '.bin', 'dsh.cmd'), '@echo off\r\n');
  await writeFile(join(runtime, 'node_modules', 'koffi', 'package.json'), JSON.stringify({ version: '2.12.0' }));
}

describe('desktop host release payload', () => {
  test('accepts only the canonical desktop-host.json descriptor name', async () => {
    const root = await temp('phase14-host-manifest-name');
    try {
      const payload = await makeHost(root);
      const manifestPath = join(payload, DESKTOP_HOST_MANIFEST_NAME);
      const manifest = await readFile(manifestPath, 'utf8');
      await rm(manifestPath);
      await writeFile(join(payload, 'manifest.json'), manifest);

      const verification = await verifyDesktopHostPayload(payload);
      expect(verification.valid).toBe(false);
      expect(verification.errors.join(' ')).toContain(`expected ${DESKTOP_HOST_MANIFEST_NAME}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('ZIP inspection requires the canonical desktop-host.json entry', async () => {
    const root = await temp('phase14-host-zip-manifest-name');
    try {
      const archive = join(root, 'release.zip');
      await writeFile(archive, 'fixture');
      const inspection = await inspectReleaseZip({
        zipPath: archive,
        platform: 'linux',
        unzipExecutable: 'fixture-unzip.exe',
        requireDesktopHost: true,
        commandRunner: async () => ({
          exitCode: 0,
          stdout: 'desktop-host/\ndesktop-host/manifest.json\ndesktop-host/app/RPG Maker Agent.exe\n',
          stderr: '',
        }),
      });
      expect(inspection.valid).toBe(false);
      expect(inspection.missing).toContain(DESKTOP_HOST_MANIFEST_RELATIVE);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('verifies the pinned host contract and confines every executable path', async () => {
    const root = await temp('phase14-host-verify');
    try {
      const payload = await makeHost(root);
      const verification = await verifyDesktopHostPayload(payload);
      expect(verification.valid).toBe(true);
      expect(verification.launchTarget).toBe('app/RPG Maker Agent.exe');
      expect(verification.hostCommit).toBe(ELECTROBUN_HOST_COMMIT);
      expect(verification.bunVersion).toBe(ELECTROBUN_BUN_VERSION);
      expect(verification.productVersion).toBe(ELECTROBUN_PRODUCT_VERSION);

      const genericManifest = {
        app: { identifier: ELECTROBUN_PRODUCT_IDENTIFIER, version: ELECTROBUN_PRODUCT_VERSION },
        bun: { version: ELECTROBUN_BUN_VERSION },
        hostCommit: ELECTROBUN_HOST_COMMIT,
        launchTarget: 'app/RPG Maker Agent.exe',
        sidecarEntrypoint: DESKTOP_HOST_SIDECAR_RELATIVE,
        supervisorExecutable: DESKTOP_HOST_SUPERVISOR_RELATIVE,
      };
      await writeFile(join(payload, DESKTOP_HOST_MANIFEST_NAME), JSON.stringify(genericManifest));
      const preProvenance = await verifyDesktopHostPayload(payload);
      expect(preProvenance.valid).toBe(false);
      expect(preProvenance.errors.join(' ')).toMatch(/provenance is missing/i);

      const escaped = await verifyDesktopHostPayload(payload, { productVersion: ELECTROBUN_PRODUCT_VERSION });
      expect(escaped.valid).toBe(false);
      await writeFile(join(payload, DESKTOP_HOST_MANIFEST_NAME), JSON.stringify({
        format: 1,
        hostCommit: ELECTROBUN_HOST_COMMIT,
        bunVersion: ELECTROBUN_BUN_VERSION,
        launchTarget: '../outside.exe',
      }));
      const rejected = await verifyDesktopHostPayload(payload);
      expect(rejected.valid).toBe(false);
      expect(rejected.errors.join(' ')).toMatch(/relative path|traversal/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects an otherwise-valid payload that omits sidecarEntrypoint', async () => {
    const root = await temp('phase14-host-missing-sidecar');
    try {
      const payload = await makeHost(root, { sidecarEntrypoint: undefined });
      const verification = await verifyDesktopHostPayload(payload);
      expect(verification.valid).toBe(false);
      expect(verification.errors.join(' ')).toMatch(/sidecarEntrypoint.*(required|non-empty relative path)/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects an otherwise-valid payload that omits supervisorExecutable', async () => {
    const root = await temp('phase14-host-missing-supervisor');
    try {
      const payload = await makeHost(root, { supervisorExecutable: undefined });
      const verification = await verifyDesktopHostPayload(payload);
      expect(verification.valid).toBe(false);
      expect(verification.errors.join(' ')).toMatch(/supervisorExecutable.*(required|non-empty relative path)/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('copies a verified payload into replaceable program data and reports the installed target', async () => {
    const root = await temp('phase14-host-copy');
    try {
      const payload = await makeHost(root);
      const program = join(root, 'program');
      const copied = await copyDesktopHostPayload(root, program, { desktopHostRoot: payload, productVersion: ELECTROBUN_PRODUCT_VERSION });
      expect(copied?.installedLaunchTarget).toBe('desktop-host/app/RPG Maker Agent.exe');
      expect(await Bun.file(join(program, copied!.installedLaunchTarget)).text()).toBe('native host fixture');
      const installedManifest = JSON.parse(await readFile(join(program, 'desktop-host', DESKTOP_HOST_MANIFEST_NAME), 'utf8')) as { hostCommit: string };
      expect(installedManifest.hostCommit).toBe(ELECTROBUN_HOST_COMMIT);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('merges the pinned host into a Release ZIP and inspects the native target', async () => {
    const root = await temp('phase14-host-zip');
    try {
      const payload = await makeHost(root);
      const archive = join(root, 'release.zip');
      await buildReleaseZip({
        sourceRoot: process.cwd(),
        outputZip: archive,
        desktopHostRoot: payload,
        platform: process.platform,
        requireDesktopHost: true,
      });
      const inspection = await inspectReleaseZip({
        zipPath: archive,
        platform: process.platform,
        requireDesktopHost: true,
      });
      expect(inspection.valid).toBe(true);
      expect(inspection.entries).toContain(`desktop-host/${DESKTOP_HOST_MANIFEST_NAME}`);
      expect(inspection.entries).toContain('desktop-host/app/RPG Maker Agent.exe');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, { timeout: 180_000 });

  test('fails a Windows-targeted archive when the native host is absent', async () => {
    const root = await temp('phase14-host-required');
    try {
      await expect(buildReleaseZip({
        sourceRoot: process.cwd(),
        outputZip: join(root, 'missing-host.zip'),
        platform: 'win32',
      })).rejects.toThrow(/required desktop-host payload/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('public release:zip refuses a hostless archive on Linux/WSL', async () => {
    const root = await temp('phase14-public-release-host-required');
    try {
      const output = join(root, 'hostless.zip');
      const result = await runBunScript(['scripts/build-release-zip.ts', output]);
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/--desktop-host-root/);
      expect(await Bun.file(output).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('installs a fresh payload with the native executable as the Start Menu target', async () => {
    const root = await temp('phase14-host-install');
    try {
      const payload = await makeHost(root);
      const bin = join(root, 'bin');
      await mkdir(bin, { recursive: true });
      const executables = ['node.exe', 'npm.cmd', 'python.exe', 'pwsh.exe', 'git.exe', 'coreutils-manager.exe', 'find.exe', 'grep.exe', 'magick.exe', 'winget.exe'];
      for (const name of executables) await writeFile(join(bin, name), 'fixture');
      const runtime = join(root, 'runtime');
      await makeMinimalDshRuntime(runtime);
      const installationRoot = join(root, 'installation');
      const program = join(installationRoot, 'program');
      const mutable = join(root, 'mutable');
      const state = join(mutable, 'state');
      const shortcut = join(root, 'Start Menu', 'RPG Maker Agent.lnk');
      let shortcutTarget = '';
      const runner = async (command: string, args: string[]) => {
        const name = basename(command).toLowerCase();
        if (args.includes('--dump-config')) return { exitCode: 0, stdout: '- id: timeout-policy\n  name: "@deepseek-ai/dsh-tool-call-timeout-policy"\n- id: agent-presets\n', stderr: '' };
        if (name === 'node.exe' && args[0] === '-p') return { exitCode: 0, stdout: 'iron\n', stderr: '' };
        if (name === 'node.exe') return { exitCode: 0, stdout: 'v22.18.0\n', stderr: '' };
        if (name === 'npm.cmd') return { exitCode: 0, stdout: '10.8.2\n', stderr: '' };
        if (name === 'python.exe') return { exitCode: 0, stdout: 'Python 3.13.15\n', stderr: '' };
        if (name === 'pwsh.exe') return { exitCode: 0, stdout: 'PowerShell 7.4.6\n', stderr: '' };
        if (name === 'git.exe') return { exitCode: 0, stdout: 'git version 2.45.0\n', stderr: '' };
        if (name === 'coreutils-manager.exe' && args[0] === '--help') return { exitCode: 0, stdout: 'Manage coreutils utilities and PowerShell profiles enable disable status\n', stderr: '' };
        if (name === 'coreutils-manager.exe' && args[0] === 'status') return { exitCode: 0, stdout: 'find enabled\ngrep enabled\n', stderr: '' };
        if (name === 'magick.exe') return { exitCode: 0, stdout: 'ImageMagick 7.1.2\n', stderr: '' };
        if (name === 'forgejo-mcp.exe') return { exitCode: 0, stdout: 'forgejo-mcp 2.34.1\n', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      };
      const env = { PATH: bin, LOCALAPPDATA: join(root, 'Local AppData'), APPDATA: join(root, 'AppData') };
      const result = await installWindowsRelease({
        platform: 'win32',
        env,
        releaseRoot: process.cwd(),
        desktopHostRoot: payload,
        requireDesktopHost: true,
        installationRoot,
        mutableRoot: mutable,
        dshHome: state,
        runtimeDir: runtime,
        nodeExecutable: join(bin, 'node.exe'),
        npmExecutable: join(bin, 'npm.cmd'),
        pythonExecutable: join(bin, 'python.exe'),
        pwshExecutable: join(bin, 'pwsh.exe'),
        gitExecutable: join(bin, 'git.exe'),
        coreutilsExecutable: join(bin, 'coreutils-manager.exe'),
        imageMagickExecutable: join(bin, 'magick.exe'),
        wingetExecutable: join(bin, 'winget.exe'),
        commandRunner: runner,
        consent: true,
        prepareAgentDependencies: async () => undefined,
        createShortcut: async (options) => {
          shortcutTarget = options.targetPath;
          await mkdir(dirname(shortcut), { recursive: true });
          await writeFile(shortcut, shortcutTarget);
          return shortcut;
        },
      });
      expect(result.launchTarget).toBe('desktop-host/app/RPG Maker Agent.exe');
      expect(shortcutTarget).toBe(join(program, 'desktop-host', 'app', 'RPG Maker Agent.exe'));
      expect(JSON.parse(await readFile(join(program, 'install.json'), 'utf8')).launchTarget).toBe(result.launchTarget);
      expect(await Bun.file(join(program, result.launchTarget)).text()).toBe('native host fixture');

      // The same package path upgrades the owned host and leaves mutable DSH
      // data outside the replaceable program-tree transaction.
      await writeFile(join(state, '.credentials.yaml'), 'provider: local\n');
      await writeFile(join(mutable, 'workspace-history.json'), '{"last":"mv"}\n');
      await mkdir(join(mutable, 'cache'), { recursive: true });
      await mkdir(join(mutable, 'logs'), { recursive: true });
      await writeFile(join(mutable, 'cache', 'kept.txt'), 'cache\n');
      await writeFile(join(mutable, 'logs', 'kept.log'), 'log\n');
      const stopped: number[] = [];
      const upgraded = await installWindowsRelease({
        platform: 'win32',
        env,
        releaseRoot: process.cwd(),
        desktopHostRoot: payload,
        requireDesktopHost: true,
        installationRoot,
        mutableRoot: mutable,
        dshHome: state,
        runtimeDir: runtime,
        nodeExecutable: join(bin, 'node.exe'),
        npmExecutable: join(bin, 'npm.cmd'),
        pythonExecutable: join(bin, 'python.exe'),
        pwshExecutable: join(bin, 'pwsh.exe'),
        gitExecutable: join(bin, 'git.exe'),
        coreutilsExecutable: join(bin, 'coreutils-manager.exe'),
        imageMagickExecutable: join(bin, 'magick.exe'),
        commandRunner: runner,
        consent: true,
        ownedProcessRecords: [{ pid: 501, parentPid: 1, executablePath: join(program, 'desktop-host', 'app', 'RPG Maker Agent.exe') }],
        ownedAgentConsent: () => true,
        stopOwnedProcessTree: async (pid) => { stopped.push(pid); },
        prepareAgentDependencies: async () => undefined,
        createShortcut: async (options) => {
          shortcutTarget = options.targetPath;
          await writeFile(shortcut, shortcutTarget);
          return shortcut;
        },
      });
      expect(upgraded.launchTarget).toBe(result.launchTarget);
      expect(stopped).toEqual([501]);
      await expect(readFile(join(state, '.credentials.yaml'), 'utf8')).resolves.toBe('provider: local\n');
      await expect(readFile(join(mutable, 'workspace-history.json'), 'utf8')).resolves.toBe('{"last":"mv"}\n');
      await expect(readFile(join(mutable, 'cache', 'kept.txt'), 'utf8')).resolves.toBe('cache\n');
      await expect(readFile(join(mutable, 'logs', 'kept.log'), 'utf8')).resolves.toBe('log\n');

      await expect(installWindowsRelease({
        platform: 'win32',
        env,
        releaseRoot: process.cwd(),
        desktopHostRoot: payload,
        requireDesktopHost: true,
        installationRoot,
        mutableRoot: mutable,
        dshHome: state,
        runtimeDir: runtime,
        nodeExecutable: join(bin, 'node.exe'),
        npmExecutable: join(bin, 'npm.cmd'),
        pythonExecutable: join(bin, 'python.exe'),
        pwshExecutable: join(bin, 'pwsh.exe'),
        gitExecutable: join(bin, 'git.exe'),
        coreutilsExecutable: join(bin, 'coreutils-manager.exe'),
        imageMagickExecutable: join(bin, 'magick.exe'),
        commandRunner: runner,
        consent: true,
        prepareAgentDependencies: async () => undefined,
        writeInstallMetadata: async () => { throw new Error('simulated metadata failure'); },
        createShortcut: async () => shortcut,
      })).rejects.toThrow(/prior program tree was restored/i);
      expect(await Bun.file(join(program, upgraded.launchTarget)).exists()).toBe(true);
      await expect(readFile(join(state, '.credentials.yaml'), 'utf8')).resolves.toBe('provider: local\n');
      await expect(readFile(join(mutable, 'workspace-history.json'), 'utf8')).resolves.toBe('{"last":"mv"}\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects a payload root that is a symlink', async () => {
    const root = await temp('phase14-host-symlink');
    try {
      const payload = await makeHost(root);
      const alias = join(root, 'alias');
      await symlink(payload, alias, 'junction');
      const verification = await verifyDesktopHostPayload(alias);
      expect(verification.valid).toBe(false);
      expect(verification.errors.join(' ')).toMatch(/real directory/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('owned upgrade lifecycle', () => {
  test('finds only processes whose executable or command line is beneath the owned root', async () => {
    const root = await temp('phase14-owned-processes');
    try {
      const installationRoot = join(root, 'installation');
      const program = join(installationRoot, 'program');
      await mkdir(program, { recursive: true });
      await writeFile(join(program, PROGRAM_OWNERSHIP_FILE), JSON.stringify({ owner: PROGRAM_OWNER, product: PRODUCT_NAME, format: 1 }));
      const processes = await findOwnedAgent(program, {
        platform: 'win32',
        processRecords: [
          { pid: 10, parentPid: 1, executablePath: join(program, 'desktop-host', 'DSH.exe') },
          { pid: 11, parentPid: 10, commandLine: `"${program.replaceAll('/', '\\')}\\src\\electrobun-sidecar.js"` },
          { pid: 12, parentPid: 1, executablePath: `${program}-copy\\DSH.exe` },
          { pid: 13, parentPid: 1, image: 'DSH.exe' },
        ],
      });
      expect(processes?.processes.map((process) => process.pid)).toEqual([10, 11]);
      expect(processes?.rootPids).toEqual([10]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('asks once, leaves the tree untouched on decline, and stops only owned roots on consent', async () => {
    const root = await temp('phase14-owned-consent');
    try {
      const program = join(root, 'program');
      await mkdir(program, { recursive: true });
      await writeFile(join(program, PROGRAM_OWNERSHIP_FILE), JSON.stringify({ owner: PROGRAM_OWNER, product: PRODUCT_NAME, format: 1 }));
      const processRecords = [{ pid: 20, parentPid: 1, executablePath: join(program, 'DSH.exe') }];
      let asked = 0;
      let stopped: number[] = [];
      await expect(confirmAndStopOwnedAgent({
        platform: 'win32',
        programRoot: program,
        processRecords,
        consent: () => { asked += 1; return false; },
        stopProcessTree: async (pid) => { stopped.push(pid); },
      })).rejects.toBeInstanceOf(RunningAgentCloseDeclinedError);
      expect(asked).toBe(1);
      expect(stopped).toEqual([]);

      await confirmAndStopOwnedAgent({
        platform: 'win32',
        programRoot: program,
        processRecords,
        consent: () => { asked += 1; return true; },
        stopProcessTree: async (pid) => { stopped.push(pid); },
      });
      expect(asked).toBe(2);
      expect(stopped).toEqual([20]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('declining an active owned upgrade happens before prerequisite or tree mutation', async () => {
    const root = await temp('phase14-owned-upgrade-noop');
    try {
      const installationRoot = join(root, 'installation');
      const program = join(installationRoot, 'program');
      const mutable = join(root, 'mutable');
      const state = join(mutable, 'state');
      await mkdir(program, { recursive: true });
      await mkdir(state, { recursive: true });
      await writeFile(join(program, PROGRAM_OWNERSHIP_FILE), JSON.stringify({ owner: PROGRAM_OWNER, product: PRODUCT_NAME, format: 1 }));
      await writeFile(join(program, 'old-tree.txt'), 'prior install');
      await writeFile(join(state, '.credentials.yaml'), 'provider: local\n');

      await expect(installWindowsRelease({
        platform: 'win32',
        releaseRoot: join(process.cwd()),
        installationRoot,
        mutableRoot: mutable,
        dshHome: state,
        ownedProcessRecords: [{ pid: 99, parentPid: 1, executablePath: join(program, 'desktop-host', 'DSH.exe') }],
        ownedAgentConsent: () => false,
      })).rejects.toBeInstanceOf(ReleaseGateError);
      expect(await readFile(join(program, 'old-tree.txt'), 'utf8')).toBe('prior install');
      expect(await readFile(join(state, '.credentials.yaml'), 'utf8')).toBe('provider: local\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('parses one-row and multi-row CIM JSON without trusting process names', () => {
    expect(parseWindowsProcessTable('{"ProcessId":42,"ParentProcessId":1,"Name":"DSH.exe"}')).toEqual([
      { pid: 42, parentPid: 1, image: 'DSH.exe', executablePath: undefined, commandLine: undefined },
    ]);
    expect(parseWindowsProcessTable('[{"ProcessId":42,"ParentProcessId":1},{"ProcessId":43,"ParentProcessId":42}]')).toHaveLength(2);
  });

  test('uses taskkill tree termination for an accepted Windows root', async () => {
    let call: { command: string; args: string[] } | undefined;
    await stopWindowsProcessTree(42, {
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      commandRunner: async (command, args) => {
        call = { command, args };
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    expect(call?.command.replaceAll('\\', '/').toLowerCase()).toBe('c:/windows/system32/taskkill.exe');
    expect(call?.args).toEqual(['/PID', '42', '/T', '/F']);
  });
});
