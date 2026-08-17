import { runPlaytestWorkflow } from './playtest-debug-core.js'

export const name = 'playtest-debug-workflow'
export const inject = ['tools']

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'playtest_debug',
    description: 'Validate the RPG Maker project, launch/observe/stop NW.js Playtest, and report truthful launch versus behavior outcomes.',
    parameters: { type: 'object', properties: { runtimePath: { type: 'string' } }, additionalProperties: false },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
    },
    timeoutMs: 120000,
    execute: (args, exec) => runPlaytestWorkflow({
      projectPath: process.cwd(),
      runtimePath: args?.runtimePath,
      signal: exec.signal,
      callTool: (tool, input, signal) => {
        const request = { callId: `playtest-debug-${Date.now()}-${tool}`, name: `mcp__rpgmaker_mv__${tool}`, arguments: input, signal: signal ?? exec.signal }
        if (exec.parent !== undefined) request.parent = exec.parent
        return ctx.tools.execute(request)
      }
    })
  }))
}
