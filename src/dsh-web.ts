import { readFile } from 'node:fs/promises';

import { findDshExecutable } from './bootstrap';
import { resolveHarnessPaths, type PathOptions } from './config';
import { commandFailure, redactSensitive, runCommand, type CommandRunner } from './process';
import {
  pluginEnvironment,
  preparePnpmRuntime,
  profileDirFor,
  resolveDshInvocation
} from './profile';

export const DSH_WEB_PACKAGE = '@guionai/dsh-web';
export const DSH_WEB_VERSION = '0.3.1';
export const DSH_WEB_PROFILE = 'web';
export const LEGACY_DSH_WEB_PACKAGE = '@tta-lab/dsh-web';

export interface DshWebPluginOptions extends PathOptions {
  dshExecutable?: string;
  npmExecutable?: string;
  pnpmExecutable?: string;
  pnpmRuntimeDir?: string;
  commandRunner?: CommandRunner;
}

async function profileHasDependency(profileDir: string, packageName: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(await readFile(`${profileDir}/package.json`, 'utf8')) as { dependencies?: Record<string, unknown> };
    return typeof manifest.dependencies?.[packageName] === 'string';
  } catch {
    return false;
  }
}

/** Install the published Web profile patch through DSH's normal plugin command. */
export async function prepareDshWebPlugin(options: DshWebPluginOptions = {}): Promise<void> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const env = pluginEnvironment(options.env ?? process.env);
  const pnpm = await preparePnpmRuntime({ ...options, useAppOwnedPnpm: true }, paths);
  const dsh = options.dshExecutable ?? env.DSH_EXECUTABLE ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!dsh) throw new Error('Pinned DSH executable was not found; cannot install the shared Web profile package.');
  const invocation = await resolveDshInvocation(dsh, options, env);
  const runner = options.commandRunner ?? runCommand;
  const profileDir = profileDirFor(paths, DSH_WEB_PROFILE);
  if (await profileHasDependency(profileDir, LEGACY_DSH_WEB_PACKAGE)) {
    const removeArgs = ['plugin', '--profile', DSH_WEB_PROFILE, 'remove', LEGACY_DSH_WEB_PACKAGE];
    let remove;
    try {
      remove = await runner(invocation.command, [...invocation.prefix, ...removeArgs], {
        cwd: paths.dshHome,
        env: pnpm.env,
        platform,
        timeoutMs: 15 * 60_000
      });
    } catch (error) {
      throw new Error(redactSensitive(`Shared Web profile legacy-plugin removal could not start: ${error instanceof Error ? error.message : String(error)}`, env));
    }
    if (remove.exitCode !== 0) throw new Error(redactSensitive(commandFailure(invocation.command, removeArgs, remove, env).message, env));
  }
  const packageSpec = `${DSH_WEB_PACKAGE}@${DSH_WEB_VERSION}`;
  const args = ['plugin', '--profile', DSH_WEB_PROFILE, 'add', '--save-exact', '--ignore-scripts', packageSpec];
  let result;
  try {
    result = await runner(invocation.command, [...invocation.prefix, ...args], {
      cwd: paths.dshHome,
      env: pnpm.env,
      platform,
      timeoutMs: 15 * 60_000
    });
  } catch (error) {
    throw new Error(redactSensitive(`Shared Web profile plugin manager could not start: ${error instanceof Error ? error.message : String(error)}`, env));
  }
  if (result.exitCode !== 0) throw new Error(redactSensitive(commandFailure(invocation.command, args, result, env).message, env));
}
