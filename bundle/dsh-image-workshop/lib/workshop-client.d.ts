export interface WorkshopInvocation {
  bun: string;
  args: string[];
  env: Record<string, string | undefined>;
}
export type WorkshopRunner = (bun: string, args: string[], env: Record<string, string | undefined>, signal?: AbortSignal) => Promise<string>;
export interface WorkshopChildHandle {
  pid?: number;
  exitCode: number | null;
  signalCode: string | null;
  kill(signal?: string): boolean;
}
export type WorkshopChildSpawner = (bun: string, args: string[], options: Record<string, unknown>) => WorkshopChildHandle;
export type WorkshopTreeTerminator = (child: WorkshopChildHandle) => void;
export declare function workshopEnvironment(env?: Record<string, string | undefined>): Record<string, string | undefined>;
export declare function setWorkshopRunner(runner: WorkshopRunner): void;
export declare function clearWorkshopRunner(): void;
export declare function setChildSpawner(spawner?: WorkshopChildSpawner): void;
export declare function clearChildSpawner(): void;
export declare function setTreeTerminator(terminator?: WorkshopTreeTerminator): void;
export declare function clearTreeTerminator(): void;
export declare function invokeImageOperation(operation: string, cliArgs: string[], env?: Record<string, string | undefined>, signal?: AbortSignal): Promise<Record<string, unknown>>;
