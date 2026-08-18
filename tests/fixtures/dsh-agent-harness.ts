/**
 * Deterministic DSH rc.7 Agent-seam harness owned by the Ticket 01 tests.
 *
 * It replicates exactly the rc.7 plugin surface the dsh-workspace-mcp bundle
 * depends on — host `ctx.on('agent/created')`, agent-scoped `agent.ctx` with
 * `tools.register()`/`on('system-prompt/assemble')` effects that unwind on
 * disposal, and a `system-prompt/assemble` waterfall whose base tool schemas
 * come from the agent's tool registry. It never touches a live DSH home,
 * profile, or runtime.
 */
export interface HarnessToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface HarnessToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => Array<{ type: string; text: string }> };
  execute: (args: Record<string, unknown>, exec: { signal?: AbortSignal }) => Promise<unknown>;
}

export interface HarnessAgent {
  id: string;
  session: { header: { cwd?: string; agentPreset?: string } };
  ctx: HarnessScope;
}

export interface PromptAssembly {
  sections: unknown[];
  contexts: unknown[];
  tools: HarnessToolSchema[];
  variables: Record<string, string | undefined>;
}

type Listener = (...args: unknown[]) => unknown;

class ToolRegistry {
  readonly entries: HarnessToolDefinition[] = [];
  private readonly effects: Array<() => void>;

  constructor(effects: Array<() => void>) {
    this.effects = effects;
  }

  register(definition: HarnessToolDefinition): () => void {
    this.entries.push(definition);
    let removed = false;
    const disposer = () => {
      if (removed) return;
      removed = true;
      const index = this.entries.indexOf(definition);
      if (index >= 0) this.entries.splice(index, 1);
    };
    // Mirror rc.7: a scoped `ctx.tools.register` is a scope effect that
    // unwinds when the agent context is disposed.
    this.effects.push(disposer);
    return disposer;
  }

  get(name: string): HarnessToolDefinition | undefined {
    return this.entries.find((definition) => definition.name === name);
  }

  schemas(): HarnessToolSchema[] {
    return this.entries.map((definition) => ({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters
    }));
  }
}

export class HarnessScope {
  readonly listeners = new Map<string, Listener[]>();
  private readonly effects: Array<() => void> = [];
  readonly tools: ToolRegistry;
  readonly logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  disposed = false;

  constructor(label: string, logger: { info: (...args: unknown[]) => void; error: (...args: unknown[]) => void } = { info() {}, error() {} }) {
    this.logger = logger;
    this.tools = new ToolRegistry(this.effects);
    if (label) this.logger.info(`harness scope ${label} created`);
  }

  on(event: string, listener: Listener): () => void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const current = this.listeners.get(event) ?? [];
      const index = current.indexOf(listener);
      if (index >= 0) current.splice(index, 1);
    };
  }

  effect(disposer: () => void): () => void {
    this.effects.push(disposer);
    return disposer;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      void listener(...args);
    }
  }

  /** Run the `system-prompt/assemble` waterfall for this scope's assembly. */
  async assemble(): Promise<PromptAssembly> {
    const assembly: PromptAssembly = {
      sections: [],
      contexts: [],
      tools: this.tools.schemas(),
      variables: {}
    };
    const listeners = [...(this.listeners.get('system-prompt/assemble') ?? [])];
    let index = 0;
    const next = async (): Promise<PromptAssembly> => {
      const listener = listeners[index];
      index += 1;
      if (!listener) return assembly;
      const result = await listener(assembly, { scope: undefined, signal: new AbortController().signal }, next);
      return result as PromptAssembly;
    };
    return next();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const disposer of [...this.effects].reverse()) disposer();
    this.listeners.clear();
    this.effects.length = 0;
  }
}

export function createHarnessAgent(id: string, header: { cwd?: string; agentPreset?: string }): HarnessAgent {
  const ctx = new HarnessScope(`agent:${id}`);
  return { id, session: { header }, ctx };
}
