# dsh-workspace-mcp

App-owned, private, prebuilt DSH bundle. It is shipped inside the RPG Maker
Agent Release ZIP, installed from the app-owned program tree, and linked into
the `web` profile as one `dsh.bundle` layer. The bundle supports workspace-
selected RPG Maker MV and MZ editing without changing the visible product name.

The package has two plugin entry points:

- `@baihestudio/dsh-workspace-mcp` — the Host service layer inserted by
  `cordis.patch.yml`. It owns one lazy MCPorter Runtime, the `(engine,
  canonical workspace)` server cache, and the pooled MV Xerolo or MZ Redseb
  children. It registers no
  tools and contains no preset roster knowledge.
- `@baihestudio/dsh-workspace-mcp/agent` — the Agent access layer mounted by a
  preset composition. Its apply context is the composition child and has no
  bound Agent; it synchronously registers the selected MV/MZ manifest tools, then
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
- Keeps **one warm stdio server per `(engine, canonical RPG Maker workspace)`**.
  MV requires `Game.rpgproject`, while MZ requires `game.rmmzproject`; both
  require direct-child `data` and `js` directories. MV starts Xerolo with
  `--project <canonical>`. MZ starts Redseb with the canonical cwd and fixed
  `RPGMAKER_PROJECT_PATH=<canonical>`. Both use an app-owned JavaScript runner
  and neutralized environment. Agents sharing a pair reuse its pooled child;
  different engines or workspaces remain isolated.
- Generates stable Agent-scoped names `rpgmaker_<raw tool name>` from the
  machine-generated, content-digest-pinned MV (41 tools) or MZ (119 tools)
  manifest. Registration is
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
workspace must contain exactly one engine marker above plus direct-child `data`
and `js` directories; parents and workspace-authored MCPorter configuration are
never searched. Agents sharing one workspace should not write to it
simultaneously: this bundle provides pooling and isolation, not a writer lock.

The bundle accepts no model-supplied executable, cwd, environment, config path,
or server definition. It performs no build on the user's machine and fetches
nothing from npm at runtime. MZ Playtest/runtime control, screenshots, input,
and build/release automation are intentionally outside this bundle. It is not
published.
