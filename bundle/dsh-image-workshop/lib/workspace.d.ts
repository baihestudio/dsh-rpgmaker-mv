export declare class ImageWorkshopWorkspaceError extends Error {
  name: 'ImageWorkshopWorkspaceError';
}
export declare function validateRelativePath(raw: unknown, label?: string): string;
export declare function resolveWorkspacePath(workspace: string, raw: unknown, options?: {
  platform?: string;
  label?: string;
  forOutput?: boolean;
}): Promise<string>;
