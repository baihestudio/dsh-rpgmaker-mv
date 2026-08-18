export interface WorkshopInvocation {
  bun: string;
  args: string[];
  env: Record<string, string | undefined>;
}
export type WorkshopRunner = (bun: string, args: string[], env: Record<string, string | undefined>, signal?: AbortSignal) => Promise<string>;
export declare function workshopEnvironment(env?: Record<string, string | undefined>): Record<string, string | undefined>;
export declare function setWorkshopRunner(runner: WorkshopRunner): void;
export declare function clearWorkshopRunner(): void;
export declare function invokeImageOperation(operation: string, cliArgs: string[], env?: Record<string, string | undefined>, signal?: AbortSignal): Promise<Record<string, unknown>>;
