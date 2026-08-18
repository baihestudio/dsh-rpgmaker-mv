# RPG Maker MV MCP selection for DSH

**Decision:** ship `@xerolo44/rpgmaker-mv-mcp@0.1.0` first, pinned to npm version `0.1.0` (published artifact `gitHead` `51efd5360a2658b4064d2501597b0d1bec61520f`). It is the best **Windows-first DSH choice**: its advertised schemas pass the official DSH schema subset, it covers the required MV editing surface, and it has the only credible Windows Playtest path with status, stdout/stderr capture, and stop controls.

Windows is release-blocking. macOS is best effort and does not overturn this decision.

## Why this is the decision

The raw-capability winner is `rpgmaker-mv-mcp` / RPG Maker MV Ultimate 5.14.2, but its actual consolidated schemas advertise `type: ["number", "string"]` for IDs. DSH's official raw-schema validator accepts only one type string and explicitly rejects type arrays. The MCP bridge passes the server's `inputSchema` directly to DSH's tool registry. Therefore the 5.14.2 server is not safe to ship through the official DSH client without an upstream schema fix; maximum feature count is irrelevant if discovery fails.

Xerolo's 41 tool schemas are Zod-generated object schemas with no `type` arrays, `nullable`, or `oneOf` in the input surface. It passed the disposable MCP probe and its repository smoke test. Its Windows-oriented NW.js wrapper launches `[project, "test"]`, captures stdout/stderr, reports status, exposes logs, and stops the tracked process. This is materially better for the release-blocking Windows Playtest workflow than Ultimate's detached, launch-only, Windows-only `playtest` tool.

## Primary-source comparison

| Candidate | Source/license/activity | MCP surface and MV coverage | Windows Playtest | DSH schema/discovery | Decision |
|---|---|---|---|---|---|
| **`@xerolo44/rpgmaker-mv-mcp` 0.1.0** | MIT; npm package declares Node `>=18`; repository's release-readiness commit is `51efd5360a2658b4064d2501597b0d1bec61520f`; no tagged GitHub releases at probe time. [package.json](https://github.com/Xerolo44/RPG-Maker-MV-MCP/blob/51efd5360a2658b4064d2501597b0d1bec61520f/package.json) | **41 tools**: all 12 MV database arrays, System.json, maps/events, event commands/dialogue, plugins, search, validation, backups/restore, skill helpers. It intentionally does not paint tile data. [README](https://github.com/Xerolo44/RPG-Maker-MV-MCP/blob/51efd5360a2658b4064d2501597b0d1bec61520f/README.md), [tool registration](https://github.com/Xerolo44/RPG-Maker-MV-MCP/blob/51efd5360a2658b4064d2501597b0d1bec61520f/src/index.ts) | **Yes, wrapper-level verified:** Windows candidates include Steam/KADOKAWA paths, project `Game.exe`, and `RPGMAKER_MV_NWJS`; `spawn(runtime, [project.root, "test"])`; `playtest_log`, `playtest_status`, `playtest_stop`. [playtestTools.ts](https://github.com/Xerolo44/RPG-Maker-MV-MCP/blob/51efd5360a2658b4064d2501597b0d1bec61520f/src/tools/playtestTools.ts) | **Passes the schema probe.** No unions/type arrays/nullable input nodes were found in the 41 live schemas. | **Recommend.** Best usable Windows/DSH trade-off. |
| **`rpgmaker-mv-mcp` / RPG Maker MV Ultimate 5.14.2** | MIT; npm latest 5.14.2; release commit `d0464a14e37eb36bcf07d74c78d720eb410cf69e`; 5.14.2 release notes document Playtest/write-safety. [npm](https://www.npmjs.com/package/rpgmaker-mv-mcp/v/5.14.2), [release commit](https://github.com/DiegoLopez0208/RpgMakerMVUltimate-MCP/tree/d0464a14e37eb36bcf07d74c78d720eb410cf69e), [README](https://github.com/DiegoLopez0208/RpgMakerMVUltimate-MCP/blob/d0464a14e37eb36bcf07d74c78d720eb410cf69e/README.md) | **13 consolidated tools**, with 101 legacy aliases optionally advertised. Strongest MV-specific intelligence: database CRUD, tile/map editing and generation, event presets, plugin authoring, project analysis, validation, search, and knowledge derived from MV engine data. [toolDefinitions.ts](https://github.com/DiegoLopez0208/RpgMakerMVUltimate-MCP/blob/d0464a14e37eb36bcf07d74c78d720eb410cf69e/src/toolDefinitions.ts) | `manage_system.playtest` launches the Windows NW.js runtime detached and returns a PID. It does not capture console output, expose status/logs, or provide screenshots/input. The source explicitly describes Playtest/editor launch as Windows-only. [runTools.ts](https://github.com/DiegoLopez0208/RpgMakerMVUltimate-MCP/blob/d0464a14e37eb36bcf07d74c78d720eb410cf69e/src/tools/runTools.ts) | **Fails DSH compatibility as shipped.** `ID_TYPE` is `{type: ['number', 'string']}` and appears throughout the advertised schemas. DSH's official validator rejects type arrays. [source](https://github.com/DiegoLopez0208/RpgMakerMVUltimate-MCP/blob/d0464a14e37eb36bcf07d74c78d720eb410cf69e/src/toolDefinitions.ts) | **Reject for this DSH release.** Reconsider after upstream changes every type array to a DSH-supported `oneOf`. |
| **HeroLink** | MIT; Node `>=20`; no tagged releases; latest source commit in the probed repository is `30f97903a8da` (June 10 source activity). [package.json](https://github.com/ZDOSS/HeroLink/blob/30f97903a8da/package.json), [README](https://github.com/ZDOSS/HeroLink/blob/30f97903a8da/README.md) | **27 tools**. Good normalized MV/MZ model, reference validation, constrained events/maps/plugins, optional BridgeInspector runtime inspection, and a deliberate draft → diff → apply → rollback transaction workflow. It has no Playtest launch/status/log tool; `inspect_runtime` requires installing and loading its optional plugin. | **No launch path.** It can inspect a running game only after manual BridgeInspector installation/configuration. | Input schemas are mostly simple; three event schemas use `oneOf`, which the official DSH subset supports. This is not enough to compensate for the missing Windows Playtest path and extra human review workflow. | **Reject.** Better as a review/apply desktop bridge, not the first DSH MCP for direct Windows game work. |

`rpgmaker-mv-mcp` in the original candidate list is the npm name of the DiegoLopez0208 Ultimate server, not a separate implementation; it is treated as one candidate above.

## DSH compatibility evidence

The official DSH MCP client documents one plugin instance per server and passes each advertised MCP `inputSchema` into `ctx.tools.register()`. [MCP client README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md), [bridge source](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/src/tools.ts).

The official DSH raw-schema contract allows `type` values only from `object | array | string | number | integer | boolean | null`; it supports `oneOf` with at least two branches and explicitly reports `type arrays are not supported`. [Schema contract](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md), [validator source](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/json-schema.ts).

Direct live `tools/list` results from the three built servers:

| Server | Advertised tools | Schema result |
|---|---:|---|
| Ultimate 5.14.2 | 13 | 52 nested nodes with a type array; no unions/nullables. The official DSH gate would reject these schemas. |
| Xerolo 0.1.0 | 41 | No union, type-array, nullable, or `$ref` nodes in any input schema. |
| HeroLink | 27 | Three `oneOf` input schemas; no nullable/type-array nodes. `oneOf` is allowed by DSH, but the server lacks Playtest launch. |

This was a source-backed compatibility probe, not an assumed OpenAI/Claude schema compatibility claim. The official DSH checkout was not built on this macOS host because no DSH binary or installed dependency tree was present; the exact validator source was inspected and the live candidate schemas were collected from each server. The smallest follow-up after any candidate update is to run DSH's own MCP composition test with the server and confirm `mcp__<serverName>__query_database` appears before shipping.

## Reproducible probes and results

All probes used disposable MV-shaped projects under the OS temporary directory. No live RPG Maker project or repository file was used.

### Candidate build/test probes

```sh
# Source snapshots were downloaded into /tmp; these commands do not modify this repo.
cd /tmp/rpg-mcp-probes/ultimate && npm ci --ignore-scripts && npm run build && npm test
cd /tmp/rpg-mcp-probes/xerolo && npm ci --ignore-scripts && npm run build && npm run smoke
cd /tmp/rpg-mcp-probes/herolink && npm ci --ignore-scripts && npm run build && npm test
```

Results:

- Ultimate: **275 tests passed / 22 files**. Its tests cover MV references, validation, atomic writes/backups, plugin tools, map/event generation, and Playtest path logic.
- Xerolo: `npm run smoke`: **all smoke tests passed**. It exercised project selection/info, database read/write/create, event create/update/delete, plugin configure/create/read/write, skill helpers, search, validation, backups/restore, browser Playtest HTTP fetch, status, stop, and missing-record errors.
- HeroLink: **190 tests passed / 19 files**. Tests cover schema conformance, transaction safety, rollback, MV/MZ adapters, HTTP, and optional in-engine integration.

### Cross-candidate live MCP probe

The probe started each compiled server over stdio with the same fixture and called representative operations.

```text
Ultimate: listTools=13; get_project_context=OK; query_database=OK;
         query_map=OK; update_database_entry=OK; manage_map_event=OK;
         analyze_project=OK; manage_system(playtest)=expected error on fixture
         (fixture lacked index.html/package.json).
Xerolo:  listTools=41; get_project_info=OK; list_records=OK;
         update_record=OK; create_event=OK; validate_project=OK;
         list_backups=OK; playtest browser=OK; HTTP GET data/System.json=200;
         playtest_status=OK; playtest_stop=OK;
         missing-record call returned MCP error.
HeroLink:listTools=27; get_project_status=OK; list_project_data=OK;
         create_item_draft=OK; list_pending_changes=OK; apply_patch=OK;
         list_backups=OK; inspect_runtime correctly reported BridgeInspector absent.
```

The upstream Xerolo `scripts/smoke.mjs` is the reproducible fixture and end-to-end probe. The equivalent direct probe used `@modelcontextprotocol/sdk` `Client` + `StdioClientTransport`, sent `tools/list`, then `tools/call` requests, and shut down with `client.close()`; all three stdio children shut down cleanly from the client harness.

### Windows Playtest wrapper substitute probe

A real Windows NW.js executable cannot run on this macOS host. The smallest safe substitute was an executable temporary shell script supplied as Xerolo's `runtimePath`. The probe verified the wrapper's observable contract without opening a game or touching live state:

```text
playtest_start(mode=nwjs, runtimePath=fake): returned pid and mode=nwjs
fake runtime received: <fixture-project> test
playtest_log: captured fake stdout and fake stderr
playtest_stop: returned the tracked nwjs pid
```

The real Windows verification still required is listed below. The fake shell also exposed a general process-tree caveat: killing a shell wrapper can leave its child `sleep` process behind. A real MV `Game.exe` should be tested directly, not through a shell wrapper; the installer/profile must not introduce one.

## Recommended installation and exact Cordis entries

### Pinned installation

Install Node.js 18+ and the exact npm artifact once, outside the MCP child startup path:

```sh
npm install --global @xerolo44/rpgmaker-mv-mcp@0.1.0
```

The package's executable is `rpgmaker-mv-mcp`. Keep the global npm bin directory on the DSH process `PATH`. Do not use an unpinned `latest` package. If global npm bin is not on PATH, use the absolute executable path in the `command` field instead.

DSH's official MCP client passes `args` directly (no shell interpolation), so Windows uses the npm-generated `.cmd` shim. The `RPGMV_PROJECT_DIR` environment variable is intentionally not used here: Xerolo's `--project` argument is explicit and avoids ambiguity when DSH starts in a different directory.

### Windows (release-blocking)

Put this in the profile's `cordis.patch.yml` (or equivalent profile composition layer), with the project workspace as DSH's current working directory:

```yaml
- insert:
    - id: mcp-rpgmaker-mv
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: rpgmaker_mv
        transport: stdio
        command: rpgmaker-mv-mcp.cmd
        args: ['--project', !!js process.cwd()]
        cwd: !!js process.cwd()
        toolCallTimeoutMs: 60000
        failOnStartupError: true
```

The `!!js process.cwd()` argument is evaluated by Cordis and becomes the project path string. If the profile must launch from a fixed project directory instead, replace both `cwd` and the argument with the same absolute path. The command must resolve to the installed `.cmd` shim; an absolute path is safest on machines with multiple Node installations.

### macOS (best effort, non-blocking)

Use the same pinned install and profile entry, but use the non-shim executable:

```yaml
- insert:
    - id: mcp-rpgmaker-mv
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: rpgmaker_mv
        transport: stdio
        command: rpgmaker-mv-mcp
        args: ['--project', !!js process.cwd()]
        cwd: !!js process.cwd()
        toolCallTimeoutMs: 60000
        failOnStartupError: true
```

The MCP editing surface and browser Playtest path work on macOS in the disposable probe. The NW.js candidate path in the source is `/Applications/RPG Maker MV/RPG Maker MV.app/Contents/MacOS/nwjs-osx-test/Game.app/Contents/MacOS/Game`; it was not verified against installed macOS RPG Maker hardware here. Do not make macOS runtime launch a release gate.

### DSH-side operational notes

- `serverName: rpgmaker_mv` produces model-facing names such as `mcp__rpgmaker_mv__list_records`; the raw wire names remain Xerolo's names.
- Keep `failOnStartupError: true` so schema or executable failures are visible during profile activation rather than silently producing zero tools.
- The MCP child has direct file-system authority outside DSH's agent sandbox. The official DSH CLI explicitly warns that MCP server commands are trusted executable code; only connect this server to a project workspace the user intends to edit. [DSH CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md).
- First-release editing model: the agent/MCP is the sole writer. RPG Maker MV may remain open only as a read-only reference; users must not save from it because the editor retains the database in memory and can overwrite the server's JSON changes. Reopen the project before inspecting agent changes. [Xerolo README](https://github.com/Xerolo44/RPG-Maker-MV-MCP/blob/51efd5360a2658b4064d2501597b0d1bec61520f/README.md).
- The server's `.mcp-backups/` directory belongs in the game project's `.gitignore`; the project itself remains version-controlled.

## Required workflows and observed behavior

| Workflow | Recommended call sequence | Result/constraint |
|---|---|---|
| Inspect project | `get_project_info`, `list_records`, `list_maps`, `list_plugins` | Works; MV arrays are normalized around the null index 0. |
| Modify database | `get_record` → `update_record`/`create_record` → `validate_project` | Immediate writes; first change to a file in the server session is backed up. |
| Modify events/maps | `get_map`/`get_event` → `create_event`/`update_event`/`add_event_command`/`add_dialogue` | Works; tile painting remains an editor job. |
| Modify plugins | `list_plugins` → `configure_plugin` or `create_plugin`/`write_plugin` | Works with MV `js/plugins.js`; close the editor first. |
| Diagnose | `validate_project`, `search_records`, `search_map_events`, `event_command_reference` | Static reference checks and text/command searches work. |
| Windows Playtest | `playtest_start {"mode":"nwjs"}` → `playtest_status`/`playtest_log` → `playtest_stop` | Wrapper supports launch/status/log/stop. Real Windows NW.js/game verification remains mandatory. |
| macOS fallback | `playtest_start {"mode":"browser"}` and return URL | Browser server worked on macOS; console remains in browser devtools, not MCP output. |

## What “agent tests its own fix” means

With Xerolo alone:

1. **Static verification:** supported and useful: validation, searches, event-command inspection, and database/map re-read after the write.
2. **Windows launch verification:** supported by the MCP wrapper once the real MV runtime is installed: launch in test mode, inspect captured NW.js stdout/stderr, check status, and stop it.
3. **Crash/console verification:** supported only to the extent that the real NW.js build emits useful stdout/stderr. It is not a browser-console or game-state oracle.
4. **Screenshot/input/scripted gameplay:** not provided by this MCP. A successful process launch does not prove a player can reach the changed event or that the visual/gameplay behavior is correct.
5. **macOS:** browser launch is the safe fallback; native NW.js and editor launch are best effort only.

### Smallest supplement

Do **not** ship a second overlapping RPG Maker MCP. Add one focused DSH skill/profile instruction that makes the verification loop explicit:

- treat the agent/MCP as the sole writer; if the editor remains open, clearly warn that it is read-only and must not save;
- read/validate after every mutation;
- on Windows, launch `playtest_start(mode=nwjs)`, poll `playtest_status`, read `playtest_log`, and stop it;
- classify “process launched” separately from “behavior verified”;
- for behavior that needs screenshots, keyboard input, or scripted traversal, hand off to the existing DSH browser/desktop automation capability rather than expanding this MCP.

If product later requires unattended in-game assertions, the smallest new capability is a separate Playtest harness that owns process-tree termination, screenshots/input, and a test script; it should not duplicate database/map/plugin editing.

## Rejected alternatives and revisit conditions

- **Ultimate 5.14.2:** revisit immediately after a release replaces every `type: ['number','string']` input node with a DSH-valid `oneOf` schema and adds a DSH discovery test. It remains attractive for map generation/intelligence, but its current Playtest is launch-only and Windows-only.
- **HeroLink:** revisit if it gains a Windows NW.js Playtest controller and a direct-edit mode. Its current draft/apply workflow is safer but adds ceremony the DSH product context explicitly does not prioritize.
- **Overlapping servers:** do not combine Xerolo with Ultimate or HeroLink. One server avoids duplicate tool names, conflicting write/backup models, and model choice ambiguity.

## Remaining verification before release

The macOS host could not run a real Windows MV installation. A Windows release gate must run, on a disposable project with paths containing spaces and preferably CJK characters:

1. install the pinned npm package and start it through the exact Cordis entry;
2. verify DSH discovers `mcp__rpgmaker_mv__list_records` and the remaining tools;
3. run database, event, map metadata, plugin, validation, backup/restore calls;
4. launch a real MV project through `playtest_start(mode=nwjs)` and verify the game window opens with `test` mode;
5. create a deliberate console error and confirm `playtest_log` captures it;
6. stop the game and verify no NW.js/Game.exe descendants remain;
7. edit a file externally while a draft/change is pending and verify the documented stale/conflict behavior;
8. close the DSH session and verify the MCP child and Playtest process both terminate.

The current research is complete for the decision and install design; these are hardware/runtime acceptance checks, not reasons to delay the Windows-first selection.
