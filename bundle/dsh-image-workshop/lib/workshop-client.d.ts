export interface WorkshopInvocation {
  bun: string;
  args: string[];
  env: Record<string, string | undefined>;
}
export interface WorkshopTerminationOptions {
  env?: Record<string, string | undefined>;
  platform?: string;
  timeoutMs?: number;
}
export type WorkshopRunner = (bun: string, args: string[], env: Record<string, string | undefined>, signal?: AbortSignal) => Promise<string>;
export interface WorkshopChildHandle {
  pid?: number;
  /** Test-owned child seams may provide the modeled platform. */
  platform?: string;
  exitCode: number | null;
  signalCode: string | null;
  kill(signal?: string): boolean;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  once?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  stdout?: { on?: (event: string, listener: (...args: unknown[]) => void) => unknown; removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown };
  stderr?: { on?: (event: string, listener: (...args: unknown[]) => void) => unknown; removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown };
}
export type WorkshopChildSpawner = ((bun: string, args: string[], options: Record<string, unknown>) => WorkshopChildHandle) & { platform?: string };
export type WorkshopTreeTerminator = (child: WorkshopChildHandle, options?: WorkshopTerminationOptions) => boolean | void | Promise<boolean | void>;
export type WorkshopTerminationCommandSpawner = (command: string, args: string[], options: Record<string, unknown>) => WorkshopChildHandle;
export interface WorkshopExpectedTarget {
  path: string;
  projectPath: string;
}
export declare const IMAGE_OPERATION_CLEANUP_GRACE_MS: 5000;
export declare function workshopEnvironment(env?: Record<string, string | undefined>): Record<string, string | undefined>;
export declare function setWorkshopRunner(runner: WorkshopRunner): void;
export declare function clearWorkshopRunner(): void;
export declare function setChildSpawner(spawner?: WorkshopChildSpawner): void;
export declare function clearChildSpawner(): void;
export declare function setTreeTerminator(terminator?: WorkshopTreeTerminator): void;
export declare function clearTreeTerminator(): void;
export declare function setTerminationCommandSpawner(spawner?: WorkshopTerminationCommandSpawner): void;
export declare function clearTerminationCommandSpawner(): void;
export declare function invokeImageOperation(operation: string, cliArgs: string[], env?: Record<string, string | undefined>, signal?: AbortSignal, expectedTargets?: WorkshopExpectedTarget[]): Promise<Record<string, unknown>>;
