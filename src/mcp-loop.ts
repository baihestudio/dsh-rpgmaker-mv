import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { assertValidMvProject } from './project';

export type McpToolCaller = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export interface MutationReceipt<TMutation = unknown, TRead = unknown, TValidation = unknown> {
  mutation: TMutation;
  reread: TRead;
  validation: TValidation;
}

export interface RestoreVerification<T = unknown> {
  tool: string;
  args: Record<string, unknown>;
  matches: (value: T) => boolean;
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

function mcpError(value: unknown): string | undefined {
  const direct = objectValue(value);
  if (direct?.isError === true) {
    const content = Array.isArray(direct.content) ? direct.content : [];
    const text = content.map((item) => objectValue(item)?.text).find((item): item is string => typeof item === 'string');
    return text ?? 'MCP tool returned isError=true';
  }
  const unwrapped = objectValue(unwrapMcpResult(value));
  return unwrapped?.isError === true ? 'MCP tool returned isError=true' : undefined;
}

function fieldsMatch(value: unknown, expected: Record<string, unknown>): boolean {
  const object = objectValue(unwrapMcpResult(value));
  if (!object) return false;
  return Object.entries(expected).every(([key, expectedValue]) => {
    const actual = object[key];
    if (Object.is(actual, expectedValue)) return true;
    const expectedObject = objectValue(expectedValue);
    return expectedObject !== undefined && fieldsMatch(actual, expectedObject);
  });
}

function dialogueLinesMatch(value: unknown, lines: string[]): boolean {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const object = objectValue(node);
    if (!object) return;
    if (object.code === 401 && Array.isArray(object.parameters) && typeof object.parameters[0] === 'string') found.push(object.parameters[0]);
    Object.values(object).forEach(visit);
  };
  visit(unwrapMcpResult(value));
  return lines.every((line) => found.includes(line));
}

function pluginMatches(value: unknown, name: string, options: { status?: boolean; parameters?: Record<string, string> }): boolean {
  const list = unwrapMcpResult(value);
  if (!Array.isArray(list)) return false;
  const plugin = list.find((item) => objectValue(item)?.name === name);
  if (!plugin) return false;
  const object = objectValue(plugin)!;
  if (options.status !== undefined && object.status !== options.status) return false;
  if (options.parameters !== undefined) {
    const parameters = objectValue(object.parameters);
    if (!parameters || !Object.entries(options.parameters).every(([key, value]) => parameters[key] === value)) return false;
  }
  return true;
}

function validationError(value: unknown): string | undefined {
  const mcpFailure = mcpError(value);
  if (mcpFailure) return mcpFailure;
  const object = objectValue(unwrapMcpResult(value));
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

  private async callChecked<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const value = await this.callTool(tool, args);
    const error = mcpError(value);
    if (error) throw new Error(`RPG Maker MCP ${tool} failed: ${error}`);
    return value as T;
  }

  private async validate<T = unknown>(): Promise<T> {
    const validation = await this.callChecked<T>('validate_project', {});
    const error = validationError(validation);
    if (error) throw new Error(`RPG Maker project validation failed: ${error}`);
    return validation;
  }

  private async mutate<TMutation, TRead, TValidation>(
    mutationTool: string,
    mutationArgs: Record<string, unknown>,
    rereadTool: string,
    rereadArgs: Record<string, unknown>,
    rereadCheck: (value: TRead) => boolean
  ): Promise<MutationReceipt<TMutation, TRead, TValidation>> {
    const mutation = await this.callChecked<TMutation>(mutationTool, mutationArgs);
    const reread = await this.callChecked<TRead>(rereadTool, rereadArgs);
    if (!rereadCheck(reread)) throw new Error(`RPG Maker mutation ${mutationTool} reread did not reflect the requested change.`);
    const validation = await this.validate<TValidation>();
    return { mutation, reread, validation };
  }

  async validateProject<T = unknown>(): Promise<T> {
    return this.validate<T>();
  }

  async getDatabaseRecord<T = unknown>(type: string, id: number): Promise<T> {
    return this.callChecked<T>('get_record', { type, id });
  }

  async updateDatabaseRecord<T = unknown>(type: string, id: number, data: Record<string, unknown>, merge = true): Promise<MutationReceipt<unknown, T>> {
    return this.mutate('update_record', { type, id, data, merge }, 'get_record', { type, id }, (reread) => fieldsMatch(reread, data));
  }

  async createDatabaseRecord<T = unknown>(type: string, data: Record<string, unknown>): Promise<MutationReceipt<unknown, T>> {
    const mutation = await this.callChecked<unknown>('create_record', { type, data });
    const created = objectValue(unwrapMcpResult(mutation));
    const createdRecord = objectValue(created?.record);
    const createdInfo = objectValue(created?.created);
    const id = createdRecord?.id ?? createdInfo?.id;
    if (typeof id !== 'number') throw new Error('RPG Maker create_record did not return a new numeric id for reread.');
    const reread = await this.callChecked<T>('get_record', { type, id });
    if (!fieldsMatch(reread, data)) throw new Error('RPG Maker create_record reread did not reflect the requested data.');
    const validation = await this.validate<unknown>();
    return { mutation, reread, validation } as MutationReceipt<unknown, T>;
  }

  async updateEvent<T = unknown>(mapId: number, eventId: number, event: Record<string, unknown>): Promise<MutationReceipt<unknown, T>> {
    return this.mutate('update_event', { mapId, eventId, event }, 'get_event', { mapId, eventId }, (reread) => fieldsMatch(reread, event));
  }

  async updateEventDialogue<T = unknown>(mapId: number, eventId: number, lines: string[], pageIndex = 0): Promise<MutationReceipt<unknown, T>> {
    return this.mutate('add_dialogue', { mapId, eventId, lines, pageIndex }, 'get_event', { mapId, eventId }, (reread) => dialogueLinesMatch(reread, lines));
  }

  async updateMapMetadata<T = unknown>(mapId: number, data: Record<string, unknown>): Promise<MutationReceipt<unknown, T>> {
    return this.mutate('update_map', { mapId, data }, 'get_map', { mapId }, (reread) => fieldsMatch(reread, data));
  }

  async configurePlugin<T = unknown>(name: string, options: { status?: boolean; parameters?: Record<string, string> }): Promise<MutationReceipt<unknown, T>> {
    return this.mutate('configure_plugin', { name, ...options }, 'list_plugins', {}, (reread) => pluginMatches(reread, name, options));
  }

  async restoreBackup<TRead = unknown, TValidation = unknown>(session: string | undefined, file: string | undefined, expected: RestoreVerification<TRead>): Promise<MutationReceipt<unknown, TRead, TValidation>> {
    const args: Record<string, unknown> = {};
    if (session !== undefined) args.session = session;
    if (file !== undefined) args.file = file;
    const mutation = await this.callChecked('restore_backup', args);
    const reread = await this.callChecked<TRead>(expected.tool, expected.args);
    if (!expected.matches(unwrapMcpResult(reread) as TRead)) throw new Error('RPG Maker restore_backup reread did not reflect the expected restored state.');
    const validation = await this.validate<TValidation>();
    return { mutation, reread, validation };
  }

  async listBackups<T = unknown>(): Promise<T> {
    return this.callChecked<T>('list_backups', {});
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
