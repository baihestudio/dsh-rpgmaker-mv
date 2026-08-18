export interface WorkspaceValidation {
  valid: boolean;
  missing: string[];
  projectPath: string;
}
export interface WorkspaceServerDefinition {
  name: string;
  command: { kind: 'stdio'; command: string; args: string[]; cwd: string };
  env?: Record<string, string>;
}
export declare const MV_PROJECT_MARKER: string;
export declare const MV_REQUIRED_DIRECTORIES: readonly ['data', 'js'];
export declare const TOOL_CALL_TIMEOUT_MS: number;
export declare function canonicalWorkspace(cwd: unknown): Promise<string>;
export declare function validateWorkspace(canonical: string): Promise<WorkspaceValidation>;
export declare function privateServerName(canonical: string): string;
export declare function resolveXeroloEntry(xeroloRuntime: string): Promise<string>;
export declare function buildWorkspaceDefinition(
  canonical: string,
  paths: { xeroloRuntime: string; runner: string },
  env?: Record<string, string | undefined>
): Promise<WorkspaceServerDefinition>;
