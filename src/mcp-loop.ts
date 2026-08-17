import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertValidMvProject } from './project';

export type McpToolCaller = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface MutationReceipt<TMutation = unknown, TRead = unknown, TValidation = unknown> {
  mutation: TMutation;
  reread: TRead;
  validation: TValidation;
}

export interface BackupIgnoreGuidance {
  configured: boolean;
  needsConsent: boolean;
  suggestedEntry: '.mcp-backups/';
  gitignorePath: string;
  message: string;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function unwrapMcpResult(value: unknown): unknown {
  const result = objectValue(value);
  if (!Array.isArray(result?.content)) return value;
  const text = result.content.find((item) => objectValue(item)?.type === 'text');
  const textValue = objectValue(text)?.text;
  if (typeof textValue !== 'string') return value;
  try {
    return JSON.parse(textValue);
  } catch {
    return textValue;
  }
}

function deepContains(value: unknown, expected: unknown): boolean {
  if (Object.is(value, expected)) return true;
  if (Array.isArray(value)) return value.some((item) => deepContains(item, expected));
  const object = objectValue(value);
  const expectedObject = objectValue(expected);
  if (object && expectedObject && Object.entries(expectedObject).every(([key, expectedValue]) => key in object && deepContains(object[key], expectedValue))) return true;
  if (object) return Object.values(object).some((item) => deepContains(item, expected));
  return false;
}

function validationError(value: unknown): string | undefined {
  const result = unwrapMcpResult(value);
  const object = objectValue(result);
  if (object?.ok === false) {
    const errors = Array.isArray(object.errors) ? object.errors.map(String).join('; ') : 'project validation returned ok=false';
    return errors;
  }
  if (Array.isArray(object?.errors) && object.errors.length > 0) return object.errors.map(String).join('; ');
  return undefined;
}

export class RpgMakerEditingLoop {
  constructor(
    readonly projectPath: string,
    private readonly callTool: McpToolCaller
  ) {}

  private async mutate<TMutation, TRead, TValidation>(
    mutationTool: string,
    mutationArgs: Record<string, unknown>,
    rereadTool: string,
    rereadArgs: Record<string, unknown>,
    rereadCheck?: (value: TRead) => boolean
  ): Promise<MutationReceipt<TMutation, TRead, TValidation>> {
    const mutation = await this.callTool(mutationTool, mutationArgs) as TMutation;
    const reread = await this.callTool(rereadTool, rereadArgs) as TRead;
    if (rereadCheck && !rereadCheck(reread)) throw new Error(`RPG Maker mutation ${mutationTool} reread did not reflect the requested change.`);
    const validation = await this.callTool('validate_project', {}) as TValidation;
    const error = validationError(validation);
    if (error) throw new Error(`RPG Maker mutation ${mutationTool} was not reported successful: ${error}`);
    return { mutation, reread, validation };
  }

  async validateProject<T = unknown>(): Promise<T> {
    const validation = await this.callTool('validate_project', {}) as T;
    const error = validationError(validation);
    if (error) throw new Error(`RPG Maker project validation failed: ${error}`);
    return validation;
  }

  async getDatabaseRecord<T = unknown>(type: string, id: number): Promise<T> {
    return this.callTool('get_record', { type, id }) as Promise<T>;
  }

  async updateDatabaseRecord<T = unknown>(type: string, id: number, data: Record<string, unknown>, merge = true): Promise<MutationReceipt<unknown, T>> {
    return this.mutate('update_record', { type, id, data, merge }, 'get_record', { type, id }, (reread) => deepContains(unwrapMcpResult(reread), data));
  }

  async createDatabaseRecord<T = unknown>(type: string, data: Record<string, unknown>): Promise<MutationReceipt<unknown, T>> {
    return this.mutate('create_record', { type, data }, 'list_records', { type }, (reread) => data.name === undefined || deepContains(unwrapMcpResult(reread), { name: data.name }));
  }

  async updateEvent<T = unknown>(mapId: number, eventId: number, event: Record<string, unknown>): Promise<MutationReceipt<unknown, T>> {
    return this.mutate('update_event', { mapId, eventId, event }, 'get_event', { mapId, eventId }, (reread) => deepContains(unwrapMcpResult(reread), event));
  }

  async updateEventDialogue<T = unknown>(mapId: number, eventId: number, lines: string[], pageIndex = 0): Promise<MutationReceipt<unknown, T>> {
    return this.mutate('add_dialogue', { mapId, eventId, lines, pageIndex }, 'get_event', { mapId, eventId }, (reread) => lines.every((line) => deepContains(unwrapMcpResult(reread), line)));
  }

  async updateMapMetadata<T = unknown>(mapId: number, data: Record<string, unknown>): Promise<MutationReceipt<unknown, T>> {
    return this.mutate('update_map', { mapId, data }, 'get_map', { mapId }, (reread) => deepContains(unwrapMcpResult(reread), data));
  }

  async configurePlugin<T = unknown>(name: string, options: { status?: boolean; parameters?: Record<string, string> }): Promise<MutationReceipt<unknown, T>> {
    return this.mutate('configure_plugin', { name, ...options }, 'list_plugins', {}, (reread) => deepContains(unwrapMcpResult(reread), { name, ...options }));
  }

  async restoreBackup<T = unknown>(session?: string, file?: string): Promise<MutationReceipt<unknown, T>> {
    const args: Record<string, unknown> = {};
    if (session !== undefined) args.session = session;
    if (file !== undefined) args.file = file;
    return this.mutate('restore_backup', args, 'get_project_info', {}, (reread) => deepContains(unwrapMcpResult(reread), { root: this.projectPath }));
  }

  async listBackups<T = unknown>(): Promise<T> {
    return this.callTool('list_backups', {}) as Promise<T>;
  }
}

export async function createRpgMakerEditingLoop(projectPath: string, callTool: McpToolCaller): Promise<RpgMakerEditingLoop> {
  const validation = await assertValidMvProject(projectPath);
  return new RpgMakerEditingLoop(validation.projectPath, callTool);
}

export async function backupIgnoreGuidance(projectPath: string): Promise<BackupIgnoreGuidance> {
  const gitignorePath = join(projectPath, '.gitignore');
  let content = '';
  try {
    content = await readFile(gitignorePath, 'utf8');
  } catch {
    // A missing ignore file is a user choice; guidance never creates it silently.
  }
  const configured = content.split(/\r?\n/).some((line) => {
    const value = line.trim();
    return value === '.mcp-backups/' || value === '.mcp-backups';
  });
  return {
    configured,
    needsConsent: !configured,
    suggestedEntry: '.mcp-backups/',
    gitignorePath,
    message: configured
      ? '.mcp-backups/ is already ignored; project version control remains authoritative.'
      : 'MCP backups are stored under .mcp-backups/. Add .mcp-backups/ to .gitignore only with the user’s consent; this command does not edit .gitignore.'
  };
}
