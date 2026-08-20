export interface ProcessObservationResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(
  command: string,
  args: string[],
  env?: Record<string, string | undefined>,
  timeoutMs?: number,
  spawnProcess?: (...args: unknown[]) => unknown
): Promise<ProcessObservationResult>;

export interface LauncherProcessEvidence {
  processTableSize: number;
  launcherProcessCount: number;
  projectArgumentCount: number;
  launcherProcessObserved: boolean;
}

export function observeLauncherProcesses(options: {
  installedRoot: string;
  platform?: string;
  env?: Record<string, string | undefined>;
}): Promise<LauncherProcessEvidence>;
