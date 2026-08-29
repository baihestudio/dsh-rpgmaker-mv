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
