import { findDshExecutable } from './bootstrap';
import { resolveHarnessPaths, type PathOptions } from './config';
import { commandFailure, redactSensitive, runCommand, type CommandRunner } from './process';
import {
  pluginEnvironment,
  preparePnpmRuntime,
  resolveDshInvocation
} from './profile';

export const DSH_IMAGEGEN_PACKAGE = '@lamplitisles/dsh-imagegen';
export const DSH_IMAGEGEN_VERSION = '0.2.1';
export const DSH_IMAGEGEN_PROFILE = 'web';

export interface DshImagegenPluginOptions extends PathOptions {
  dshExecutable?: string;
  npmExecutable?: string;
  pnpmExecutable?: string;
  pnpmRuntimeDir?: string;
  commandRunner?: CommandRunner;
}

/** Install the Kepos image-generation plugin through DSH's normal profile command. */
export async function prepareDshImagegenPlugin(options: DshImagegenPluginOptions = {}): Promise<void> {
  const paths = resolveHarnessPaths(options);
  const platform = options.platform ?? process.platform;
  const env = pluginEnvironment(options.env ?? process.env);
  const pnpm = await preparePnpmRuntime({ ...options, useAppOwnedPnpm: true }, paths);
  const dsh = options.dshExecutable ?? env.DSH_EXECUTABLE ?? await findDshExecutable(paths.runtimeDir, platform);
  if (!dsh) throw new Error('Pinned DSH executable was not found; cannot install the Kepos image-generation plugin.');
  const invocation = await resolveDshInvocation(dsh, options, env);
  const packageSpec = `${DSH_IMAGEGEN_PACKAGE}@${DSH_IMAGEGEN_VERSION}`;
  const args = ['plugin', '--profile', DSH_IMAGEGEN_PROFILE, 'add', '--save-exact', '--ignore-scripts', packageSpec];
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
    throw new Error(redactSensitive(`Kepos image-generation plugin manager could not start: ${error instanceof Error ? error.message : String(error)}`, env));
  }
  if (result.exitCode !== 0) throw new Error(redactSensitive(commandFailure(invocation.command, args, result, env).message, env));
}
