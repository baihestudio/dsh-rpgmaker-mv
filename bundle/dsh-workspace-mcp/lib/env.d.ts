export declare const MCPORTER_RUNTIME_ENV: string;
export declare const XEROLO_RUNTIME_ENV: string;
export declare const JS_RUNNER_ENV: string;
export declare const SECRET_MARKER: string;
export interface RuntimePaths {
  mcporterRuntime: string;
  xeroloRuntime: string;
  runner: string;
}
export declare function resolveRuntimePaths(env?: Record<string, string | undefined>): RuntimePaths;
export declare function neutralizedServerEnv(env?: Record<string, string | undefined>): Record<string, string>;
