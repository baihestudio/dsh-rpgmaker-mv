# Redseb MZ MCP future enhancement roadmap

This is a planning record, not a runtime dependency or a promise that the
current `rpgmaker-mz-mcp@1.3.0` contract changes in this release. The product
continues to consume the upstream package and its generated manifest unchanged.
Ideas below are informed by the Redseb implementation and source-reading
reviews of [Zagos/RPG-Maker-AI-Toolkit](https://github.com/Zagos/RPG-Maker-AI-Toolkit)
and [NewtonAlves/RPG-Maker-MZ---MCP-Ultimate](https://github.com/NewtonAlves/RPG-Maker-MZ---MCP-Ultimate).

| Priority | Enhancement | User value | Prerequisites / risks | Observable acceptance target | Ownership boundary | Provenance |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | MZ Playtest lifecycle compatible with the existing Windows harness | Lets an MZ author validate a change without a second product or unsafe process bridge. | Define a supported MZ runtime discovery contract, bounded start/status/log/stop, descendant cleanup, and browser fallback; never expose arbitrary command or PID controls. | A disposable MZ project starts through the existing harness, reports status/log evidence, stops, and confirms `running: false` with no PID. | Upstream: project/runtime protocol and server-side lifecycle where reusable. Product: DSH workspace selection, manifest, Windows discovery and cleanup integration. | Redseb limitations; existing `presets/rpgmaker/skills/playtest-debug`; Zagos and Newton runtime/bridge reviews. |
| P0 | Atomic per-file writes with explicit multi-file transaction/rollback boundaries | Prevents a partial JSON update from leaving a project unreadable and makes recovery predictable. | Agree on temp-file/rename semantics across Windows; decide how a multi-file map or asset operation commits and recovers. Avoid claiming transactions where only one file is atomic. | Injected write/rename failures leave either the complete prior set or a clearly reported rollback state; no half-written JSON remains. | Upstream: `fileHandler` and commit context primitives. Product: backup retention, diagnostics, and user-facing recovery policy. | Redseb `src/utils/fileHandler.ts`; a951 atomic writer review. |
| P1 | Runtime logs, screenshots, and controlled input | Makes visual/runtime diagnosis actionable after a static validation pass. | Permission and path containment review, bounded artifact sizes, process ownership, and a no-arbitrary-code input protocol. | A disposable run returns timestamped logs and a screenshot plus a bounded input action, with artifacts scoped to the selected project and no shell/eval escape. | Upstream: protocol/tool handlers. Product: Windows harness storage, redaction, lifecycle and prompt guidance. | Newton companion/runtime bridge review; existing DSH Playtest evidence contract. |
| P1 | Bulk editing and localization workflows | Reduces repetitive edits for dialogue, database records, and translated text while preserving dry-run review. | Stable schema for batches, deterministic ordering, conflict detection, and per-file transaction semantics; avoid oversized result payloads. | A batch preview lists every affected file/record, commit is all-or-reported-none, and a reread plus reference validation confirms the result. | Upstream: batch registry, validation and dry-run implementation. Product: approval UX, workspace limits and reporting. | Redseb registry/dry-run structure; Zagos bulk/localization source-reading reference. |
| P1 | Smaller stable result payloads | Keeps Code Mode context usable on large maps and databases and makes dry-run review scannable. | Preserve machine-readable identifiers and warnings; add explicit verbose/expand reads instead of silently dropping evidence. | Default responses stay below a documented size budget while `verbose` or a targeted reread returns the complete record. | Upstream: response summary helpers and tool contracts. Product: model-facing descriptions and UI rendering policy. | Redseb response summarization and tool descriptions. |

## Upstream-first policy

Submit generally reusable fixes to Redseb first and pin a reviewed release in
this repository only after its package, manifest, schemas, and disposable
workflow are re-verified. Keep DSH-specific workspace classification, engine
pair pooling, manifest registration, credential neutralization, and Windows
harness lifecycle here. Zagos and Newton are source-reading references only:
accepted behavior must be reimplemented within Redseb's registry, validation,
and `dryRun` structure rather than importing their bridges, tool lists, assets,
or architecture wholesale.
