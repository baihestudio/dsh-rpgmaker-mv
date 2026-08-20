# dsh-workspace-mcp

App-owned, private, prebuilt DSH bundle. It is shipped inside the DSH for
RPG Maker MV Release ZIP, installed from the app-owned program tree, and linked
into the `web` profile as one `dsh.bundle` layer.

The package has two plugin entry points:

- `@baihestudio/dsh-workspace-mcp` — the Host service layer inserted by
  `cordis.patch.yml`. It owns one lazy MCPorter Runtime, the per-canonical-
  workspace server cache, and the pooled Xerolo children. It registers no
  tools and contains no preset roster knowledge.
- `@baihestudio/dsh-workspace-mcp/agent` — the Agent access layer mounted by a
  preset composition. Its apply context is the composition child and has no
  bound Agent; it synchronously registers the 41 manifest-backed tools, then
  uses rc.8's assembly context and tool execution context to initialize the
  actual Agent/session cwd. The composition, not this package, decides which
  Agents receive the row.

The Host and Agent layers share the Host generation through a WeakMap keyed by
`ctx.root`. No service is published with `ctx.provide`, and no capability is
published into the Cordis ROOT realm.

## Runtime invariants

- Owns **one lazy Host MCPorter Runtime**, created single-flight from the
  exact-pinned app-owned `mcporter` package. No home/project MCPorter config,
  editor imports, OAuth state, or external daemon is read: the runtime is
  created with an explicit empty server list and programmatic registrations.
- Keeps **one warm stdio Xerolo server per canonical RPG Maker workspace**
  (`Game.rpgproject`, `data`, `js` directly beneath the Agent session cwd).
  The first access layer for a workspace registers a deterministic private
  server name, a fixed owned JavaScript runner, the owned Xerolo entry, the
  canonical cwd, `--project`, and a neutralized environment. Later Agents in
  that workspace reuse the same pooled connection; another workspace gets a
  separate server in the same Host Runtime.
- Generates stable Agent-scoped names `rpgmaker_<raw Xerolo name>` from the
  machine-generated, content-digest-pinned manifest of the exact-pinned
  package's 41 tool names, descriptions, and input schemas. Registration is
  synchronous in the mounted composition row, before DSH's pre-waterfall
  schema collection, and uses one registration factory rather than
  hand-written wrappers. Workspace hashes, session ids, and MCP transport
  details never enter model-facing names.
- Verifies the pinned manifest before acquiring a workspace server, then
  compares live `tools/list` names and supported schemas against it before any
  execution. Missing, duplicate, drifted, invalid, or unsupported definitions
  fail the first request.
- Gates `system-prompt/assemble` on initialization, so the first request
  carries the complete validated tool set or fails visibly. An invalid
  workspace registers no server and reports the missing direct-child markers.
- Neutralizes every present credential key and ambient `DSH_*` key in the child
  definition with one constant non-secret marker. MCPorter's ambient merge
  therefore cannot carry an original value into the deterministic child.
- Passes the fixed `MCPORTER_CALL_TIMEOUT_MS` (60 seconds) to every
  `runtime.callTool`; generated tools declare no DSH timeout. Cancellation
  closes only the affected workspace server and waits for `runtime.close()` to
  confirm quiescence, with a bounded cleanup failure. Late results are
  consumed and ignored. Xerolo text/structured results and MCP errors retain
  their current behavior.
- Agent disposal removes only that Agent's registrations. Workspace servers
  remain warm until Host shutdown, which closes the one Runtime and every
  pooled child.

DSH Web owns workspace selection and switching. The launcher starts from an
app-owned neutral directory and never selects or persists a project. The
workspace must contain the three direct-child markers above; parents and
workspace-authored MCPorter configuration are never searched. Agents sharing
one workspace should not write to it simultaneously: this bundle provides
pooling and isolation, not a writer lock.

The bundle accepts no model-supplied executable, cwd, environment, config path,
or server definition. It performs no build on the user's machine and fetches
nothing from npm at runtime. It is not published.
