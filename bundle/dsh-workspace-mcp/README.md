# dsh-workspace-mcp

App-owned, private, prebuilt DSH Host plugin. It is shipped inside the DSH for
RPG Maker MV Release ZIP, installed from the app-owned program tree, and linked
into the `web` profile as one `dsh.bundle` layer (`cordis.patch.yml` inserts
the `workspace-mcp` Host row).

## What the plugin does

- Owns **one lazy Host MCPorter Runtime**, created single-flight from the
  exact-pinned app-owned `mcporter` package. No home/project MCPorter config,
  editor imports, OAuth state, or external daemon is read: the runtime is
  created with an explicit empty server list and programmatic registrations.
- Keeps **one warm stdio Xerolo server per canonical RPG Maker workspace**
  (`Game.rpgproject`, `data`, `js` directly beneath the session cwd). The first
  RPG Maker Agent for a workspace registers its internal server with a
  deterministic private name, a fixed owned Bun/Node runner, the owned Xerolo
  entry, the canonical cwd, `--project`, and a neutralized environment. Later
  Agents in that workspace reuse the same pooled connection; a different
  workspace registers a separate server in the same runtime.
- Generates **stable Agent-scoped tools** named `rpgmaker_<raw Xerolo name>`
  from a machine-generated, content-digest-pinned manifest of the exact-pinned
  package's 41 tool names, descriptions, and input schemas. The tools are
  registered synchronously at `agent/created`, so DSH's synchronous
  pre-waterfall schema collection already sees every schema in an immediately
  started first assembly. Workspace hashes, session ids, and MCP transport
  details never appear in model-facing names, and no per-tool wrapper is
  hand-written: one registration factory copies each pinned description and
  input schema and forwards every call to MCPorter by raw tool name.
- **Verifies the pinned manifest like a runtime lock fact** before any workspace
  server is acquired, then compares the live `tools/list` names and supported
  schemas against it before any tool may execute; missing, duplicate, drifted,
  invalid, or unsupported definitions fail the first request.
- **Gates `system-prompt/assemble`** for the live Agent on its initialization
  promise, so the first request either carries the complete validated tool set
  (already present from synchronous registration) or fails visibly. Invalid
  workspaces register no server and fail the first request naming the missing
  project markers; non-RPG presets register neither a server nor tools.
- Neutralizes the Xerolo child environment without scrubbing the DSH Host env:
  every present credential key and ambient `DSH_*` key is overridden in the
  server definition with one constant non-secret marker, so mcporter's
  `{...process.env, ...overrides}` merge can never carry an original value into
  the deterministic child. (Strict key absence would require an isolated broker
  process and is not required for this fixed server.)
- Preserves the 60-second call timeout, caller cancellation (contained by
  closing that workspace's server), Xerolo text/structured results, and MCP
  error results as failures.
- **Agent disposal** removes only that Agent's registrations; registered
  workspace servers stay warm until Host shutdown, which closes the one
  MCPorter Runtime and every pooled child.

DSH Web owns workspace selection and switching. The launcher starts from an
app-owned neutral directory; it does not select or persist a project. A first
request for an invalid workspace fails before a server starts and names the
missing direct-child markers. Agents sharing one workspace should not write to
it simultaneously; this bundle provides pooling and isolation, not a writer
lock.

The plugin accepts no model-supplied executable, cwd, environment, config path,
or server definition. It performs no build on the user's machine and fetches
nothing from npm at runtime. It is not published.
