# 01 — Workspace-selected MV/MZ editing loop

**What to build:** RPG Maker Agent recognizes an MV or MZ project from the selected workspace, prepares both exact-pinned editing servers, and gives each Agent only the selected engine's validated `rpgmaker_*` tools while pooling children by engine/workspace pair.

**Blocked by:** None — can start immediately.

Status: done

- [x] Direct-child markers classify valid MV and MZ workspaces; missing, incomplete, and dual-marker workspaces fail before a child starts, without parent search or live engine switching.
- [x] The unchanged app-owned MCP runtime prepares and independently verifies Xerolo and `rpgmaker-mz-mcp@1.3.0`, including exact version, bin, integrity, entrypoint, staging swap, and Doctor evidence, without runtime network access during Agent startup.
- [x] One Host MCPorter Runtime caches children by `(engine, canonical workspace)`; same-pair Agents share a child, mixed pairs remain isolated, cancellation closes only its pair, and Host shutdown closes all pairs.
- [x] Exact digest-pinned MV and MZ manifests fail closed on identity, schema, critical-capability, name, or live `tools/list` drift.
- [x] An MV Agent's first Code Mode assembly contains exactly the existing MV surface, while an MZ Agent's first assembly contains exactly the pinned Redseb surface; neither sees the other engine's unique tools or pair identity.
- [x] Representative MV behavior remains unchanged, and a disposable MZ tool call routes through the selected child with canonical cwd, fixed environment, credential neutralization, and preserved MCP result/error/cancellation behavior.
- [x] Focused workspace, runtime, manifest, Host, and real DSH Agent-seam tests pass using only test-owned roots, fixtures, and processes.

## Whole-spec review remediation (2026-08-29)

- [x] MZ Code Mode uses the official typed SDK renderer while retaining only native `run_code`; MV presentation is preserved.
- [x] MZ `set_project` is rejected for any path other than the acquired canonical workspace, and a same-Host MV/MZ concurrency regression proves pair isolation.
- [x] The private workspace bundle hash pin and profile hash validation were removed; exact engine package and manifest integrity pins remain.

## Second full re-review remediation (2026-08-29)

- [x] A single recursive projection maps raw Redseb schemas to the official DSH object-schema subset for both native registration and `renderToolsSdk`; all 119 MZ projections pass `assertObjectJsonSchema`, and nested actor/event/tile arguments render as concrete types.
- [x] MZ `set_project` accepts only a path canonicalizing to the acquired workspace (including a symlink alias), forwards that canonical path, and rejects an escape target while preserving pair identity.
- [x] The one-Host ordinary regression mounts MV and MZ concurrently and verifies isolated pair keys, tool presentations, and project state; the approval-gated real helper has the corresponding concurrent dual-mount probe but remains unrun.
- [x] Unused compatibility exports/wrappers and the obsolete engine-id alias were removed from the owned bundle and declarations.

## Final full-review remediation (2026-08-29)

- [x] Official DSH schema validation now fails closed during projection and tool registration; no invalid projection is replaced with an empty argument schema. The focused regression covers an unrepresentable schema and the 119-tool MZ validation remains green.
- [x] `manifestFor`, `contractFor`, `missingCriticalTools`, `verifyManifest`, `validateDiscoveredTools`, and `createMcpTool` all require an explicit engine. Manifest-object inference and default MV behavior are gone from the private bundle and owned callers/tests use explicit engine arguments.
