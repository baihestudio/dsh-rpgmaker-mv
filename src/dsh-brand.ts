import { join } from 'node:path';

import { findDshExecutable } from './bootstrap';
import { resolveHarnessPaths, type PathOptions } from './config';
import { commandFailure, redactSensitive, runCommand, type CommandRunner } from './process';
import {
  pluginEnvironment,
  preparePnpmRuntime,
  resolveDshInvocation
} from './profile';

export const DSH_BRAND_PACKAGE = '@baihestudio/dsh-rpgmaker-brand';
export const DSH_BRAND_PROFILE = 'web';
export const DSH_BRAND_BUNDLE_RELATIVE = join('bundle', 'dsh-rpgmaker-brand');

export interface DshBrandPluginOptions extends PathOptions {
  dshExecutable?: string;
  npmExecutable?: string;
  pnpmExecutable?: string;
  pnpmRuntimeDir?: string;
  commandRunner?: CommandRunner;
}

/** Install the release-owned RPG Maker Agent branding into the app-managed Web profile. */
export async function prepareDshBrandPlugin(options: DshBrandPluginOptions = {}): Promise<void> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const env = pluginEnvironment(options.env ?? process.env);
  const pnpm = await preparePnpmRuntime({ ...options, useAppOwnedPnpm: true }, paths);
  const dsh = options.dshExecutable ?? env.DSH_EXECUTABLE ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!dsh) throw new Error('Pinned DSH executable was not found; cannot install the RPG Maker Agent brand plugin.');
  const invocation = await resolveDshInvocation(dsh, options, env);
  const bundle = join(paths.programRoot, DSH_BRAND_BUNDLE_RELATIVE);
  const args = ['plugin', '--profile', DSH_BRAND_PROFILE, 'add', '--save-exact', '--ignore-scripts', `file:${bundle}`];
  const runner = options.commandRunner ?? runCommand;
  let result;
  try {
    result = await runner(invocation.command, [...invocation.prefix, ...args], {
      cwd: paths.dshHome,
      env: pnpm.env,
      platform,
      timeoutMs: 15 * 60_000
    });
  } catch (error) {
    throw new Error(redactSensitive(`RPG Maker Agent brand plugin manager could not start: ${error instanceof Error ? error.message : String(error)}`, env));
  }
  if (result.exitCode !== 0) throw new Error(redactSensitive(commandFailure(invocation.command, args, result, env).message, env));
}
