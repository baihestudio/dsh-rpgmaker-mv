export interface WorkspaceValidation {
  valid: boolean;
  missing: string[];
  projectPath: string;
  engine?: RpgMakerEngine;
  markers: string[];
  ambiguous: boolean;
}
export interface WorkspaceServerDefinition {
  name: string;
  command: { kind: 'stdio'; command: string; args: string[]; cwd: string };
  env?: Record<string, string>;
}
export type RpgMakerEngine = 'mv' | 'mz';
export interface EngineDefinition {
  id: RpgMakerEngine;
  marker: string;
  requiredDirectories: readonly string[];
  package: string;
  version: string;
  entry: string;
}
export declare const MV_PROJECT_MARKER: string;
export declare const MV_REQUIRED_DIRECTORIES: readonly ['data', 'js'];
export declare const MZ_PROJECT_MARKER: string;
export declare const MZ_REQUIRED_DIRECTORIES: readonly ['data', 'js'];
export declare const XEROLO_PACKAGE: string;
export declare const XEROLO_VERSION: string;
export declare const MZ_PACKAGE: string;
export declare const MZ_VERSION: string;
export declare const ENGINE_IDS: readonly RpgMakerEngine[];
export declare const RPGMAKER_ENGINES: Record<RpgMakerEngine, EngineDefinition>;
export declare const MCPORTER_CALL_TIMEOUT_MS: number;
export declare function canonicalWorkspace(cwd: unknown): Promise<string>;
export declare function classifyWorkspace(canonical: string): Promise<WorkspaceValidation>;
export declare function validateWorkspace(canonical: string): Promise<WorkspaceValidation>;
export declare function privateServerName(engine: RpgMakerEngine, canonical: string): string;
export declare function resolveEngineEntry(engine: RpgMakerEngine, runtime: string): Promise<string>;
export declare function buildWorkspaceDefinition(
  engine: RpgMakerEngine,
  canonical: string,
  paths: { rpgmakerRuntime: string; runner: string },
  env?: Record<string, string | undefined>
): Promise<WorkspaceServerDefinition>;
