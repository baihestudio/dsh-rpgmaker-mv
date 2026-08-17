// @ts-ignore The preset copy is the runtime-shared JS module loaded by DSH and tests.
import { createPlaytestProcessController as createCoreProcessController, WINDOWS_TREE_PROBE } from '../presets/playtest-debug/playtest-debug-core.js';
import type { CommandRunner } from './process';

export interface PlaytestProcessController {
  verify: (pid: number) => Promise<boolean>;
  terminate: (pid: number) => Promise<void>;
}

export interface PlaytestProcessControllerOptions {
  platform?: string;
  env?: Record<string, string | undefined>;
  commandRunner?: CommandRunner;
  pwshExecutable?: string;
}

export function createPlaytestProcessController(options: PlaytestProcessControllerOptions = {}): PlaytestProcessController {
  return createCoreProcessController(options) as PlaytestProcessController;
}

export { WINDOWS_TREE_PROBE };
