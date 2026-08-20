/**
 * Test-owned deterministic stand-in for the exact-pinned app-owned MCPorter
 * runtime (the Host MCP client pool). phase10 installs this file verbatim as
 * the fixture runtime's `node_modules/mcporter/dist/index.js`, so the bundle's
 * Host never performs an external runtime install during ordinary tests.
 *
 * It mirrors only the narrow surface the workspace MCP Host uses — lazy
 * `createRuntime({ servers: [], clientInfo, logger })`, `registerDefinition`,
 * `listServers`, schema-bearing `listTools`, pooled `callTool`, per-server
 * `close`, and final `close` — and reproduces the transport facts the Host
 * relies on: each stdio definition is spawned as a real child with the merged
 * `{...process.env, ...definition.env}` environment and the definition cwd
 * (exactly how mcporter's stdio transport merges env), one pooled child per
 * server, and no home/project config discovery of any kind.
 */
import { spawn } from 'node:child_process'
import { access, appendFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

async function waitForRelease(path) {
  while (true) {
    try {
      await access(path)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}

async function traceRuntimeClose(server, name) {
  const path = server.definition.env?.FIXTURE_RUNTIME_CLOSE_TRACE
  if (typeof path === 'string' && path.length > 0) {
    await appendFile(path, `${JSON.stringify({ name })}\n`)
  }
}

async function traceFixtureEvent(server, key, value) {
  const path = server.definition.env?.[key]
  if (typeof path === 'string' && path.length > 0) {
    await appendFile(path, `${JSON.stringify(value)}\n`)
  }
}

class FixtureServer {
  constructor(definition) {
    this.definition = definition
    this.child = null
    this.childClose = null
    this.closing = null
    this.pending = new Map() // request id -> { resolve, reject }
    this.requestId = 0
    this.initialized = null
  }

  async start() {
    // Cancellation closes the pooled child asynchronously from the Host. Do
    // not write to the old stdio while SIGTERM is still in flight; wait for
    // the close event before reconnecting a fresh child.
    if (this.closing) await this.closing
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) return this.initialized
    if (this.childClose) await this.childClose
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) return this.initialized

    const command = this.definition.command
    const child = spawn(command.command, command.args ?? [], {
      cwd: command.cwd,
      env: { ...process.env, ...(this.definition.env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    })
    this.child = child
    const childClose = new Promise((resolve) => child.once('close', resolve))
    this.childClose = childClose
    child.stderr?.resume()
    const readline = createInterface({ input: child.stdout, crlfDelay: Infinity })
    readline.on('line', (line) => {
      let message
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.id !== undefined) {
        const pending = this.pending.get(String(message.id))
        if (pending) {
          this.pending.delete(String(message.id))
          pending.resolve(message)
        }
      }
    })
    const failPending = (error) => {
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    }
    child.once('error', (error) => {
      failPending(error instanceof Error ? error : new Error(String(error)))
    })
    child.once('close', (code, signal) => {
      failPending(new Error(`dsh-workspace-mcp fixture: ${command.command} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`))
      readline.close()
      if (this.child === child) {
        this.child = null
        this.childClose = null
        this.initialized = null
      }
    })
    const send = (method, params) => new Promise((resolve, reject) => {
      const id = String(++this.requestId)
      this.pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (error) {
          this.pending.delete(id)
          reject(error)
        }
      })
    })
    this.initialized = send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dsh-workspace-mcp-fixture', version: '0.1.0' }
    }).then(() => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
      return this
    })
    return this.initialized
  }

  request(method, params) {
    const child = this.child
    if (!child) return Promise.reject(new Error('dsh-workspace-mcp fixture: server is not running'))
    return new Promise((resolve, reject) => {
      const id = String(++this.requestId)
      this.pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (error) {
          this.pending.delete(id)
          reject(error)
        }
      })
    })
  }

  async listTools() {
    const gate = this.definition.env?.FIXTURE_LIST_TOOLS_GATE
    if (typeof gate === 'string' && gate.length > 0) {
      await appendFile(`${gate}.entered`, `${JSON.stringify({ name: this.definition.name })}\n`)
      await waitForRelease(gate)
    }
    await this.start()
    const message = await this.request('tools/list', {})
    return message.result?.tools ?? []
  }

  async callTool(toolName, args, timeoutMs) {
    await this.start()
    await traceFixtureEvent(this, 'FIXTURE_CALL_TRACE', { name: this.definition.name, toolName, timeoutMs })
    const request = this.request('tools/call', { name: toolName, arguments: args ?? {} })
    if (!timeoutMs) return request
    let timer
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`RPG Maker MCP call timed out after ${timeoutMs} ms`))
        void this.killChild()
      }, timeoutMs)
      request.then((message) => { clearTimeout(timer); resolve(message) }, (error) => { clearTimeout(timer); reject(error) })
    })
  }

  async killChild() {
    if (this.closing) return this.closing
    const child = this.child
    const childClose = this.childClose
    const closing = (async () => {
      const gate = this.definition.env?.FIXTURE_CLOSE_GATE
      if (typeof gate === 'string' && gate.length > 0) {
        await appendFile(`${gate}.entered`, `${JSON.stringify({ name: this.definition.name })}\n`)
        await waitForRelease(gate)
      }
      if (!child || !childClose) return
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 2000)
      timer.unref?.()
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
        await childClose
      } finally {
        clearTimeout(timer)
      }
    })()
    this.closing = closing
    try {
      await closing
    } finally {
      if (this.closing === closing) this.closing = null
    }
  }
}

/** Narrow MCPorter Runtime surface: explicit server list, no config discovery. */
export function createRuntime({ servers = [], clientInfo, logger } = {}) {
  const serversByName = new Map()
  for (const definition of servers ?? []) {
    if (definition?.name) serversByName.set(definition.name, new FixtureServer(definition))
  }
  return {
    registerDefinition(definition, options = {}) {
      if (!definition || typeof definition.name !== 'string' || definition.name.length === 0) {
        throw new Error('dsh-workspace-mcp fixture: a server definition requires a name')
      }
      if (serversByName.has(definition.name) && !options.overwrite) {
        throw new Error(`dsh-workspace-mcp fixture: server ${definition.name} is already registered`)
      }
      serversByName.set(definition.name, new FixtureServer(definition))
      return definition.name
    },
    listServers() {
      return [...serversByName.keys()]
    },
    async listTools(name, options = {}) {
      const server = serversByName.get(name)
      if (!server) throw new Error(`dsh-workspace-mcp fixture: unknown server ${name}`)
      return server.listTools()
    },
    async callTool(name, toolName, options = {}) {
      const server = serversByName.get(name)
      if (!server) throw new Error(`dsh-workspace-mcp fixture: unknown server ${name}`)
      const message = await server.callTool(toolName, options.args, options.timeoutMs)
      await traceFixtureEvent(server, 'FIXTURE_CALL_COMPLETE_TRACE', { name, toolName, timeoutMs: options.timeoutMs })
      if (message.error) throw new Error(message.error.message ?? 'RPG Maker MCP call failed')
      return message.result
    },
    async close(name) {
      if (name !== undefined) {
        const server = serversByName.get(name)
        if (server) {
          await server.killChild()
          await traceRuntimeClose(server, name)
          if (server.definition.env?.FIXTURE_CLOSE_FAILURE === '1') throw new Error(`fixture close failed for ${name}`)
        }
        return
      }
      await Promise.all([...serversByName.entries()].map(async ([serverName, server]) => {
        await server.killChild()
        await traceRuntimeClose(server, serverName)
      }))
    }
  }
}
