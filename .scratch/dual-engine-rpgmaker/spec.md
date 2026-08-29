Status: implemented

## Problem Statement

RPG Maker Agent currently recognizes only RPG Maker MV workspaces and always starts the pinned Xerolo server. A developer who selects an RPG Maker MZ project receives an invalid-workspace failure even though the product name and workspace experience are already engine-neutral. The user needs one RPG Maker Agent that selects the correct editing MCP from the workspace itself, preserves MV behavior, and exposes only tools that actually work for the selected engine.

## Solution

Add RPG Maker MZ as a second exact-pinned workspace engine using `rpgmaker-mz-mcp@1.3.0` from Redseb. Classify the canonical workspace from direct-child project markers, then use `(engine, canonical workspace)` as the Host cache identity. MV workspaces keep one warm Xerolo server and their existing 41-tool contract; MZ workspaces receive one warm Redseb server and its pinned 119-tool contract. Each Agent registers only the selected engine's stable `rpgmaker_*` tools before its first Code Mode prompt is finalized.

Install and verify both MCP packages in the existing app-owned MCP runtime, retain the visible **RPG Maker Agent** brand and current installed directory layout, add a focused MZ authoring skill, and make active product guidance describe the two engines truthfully. MZ Playtest/runtime control is not part of this slice. Add a separate enhancement document that prioritizes possible upstream-first Redseb improvements and records useful implementation ideas from other MZ MCP projects without adopting their code wholesale.

## User Stories

1. As an MV developer, I want an MV workspace to keep the same Xerolo tools and behavior, so that adding MZ does not regress my existing workflow.
2. As an MZ developer, I want RPG Maker Agent to recognize my selected MZ project and provide Redseb's editing, map, event, tile, dry-run, and validation tools, so that I can author the project without a separate product or manual MCP setup.
3. As a developer using multiple workspaces, I want each engine/workspace pair to own one isolated warm MCP server, so that Agents share the right project state without crossing engines or projects.
4. As a developer starting an Agent, I want to see only the tools for that workspace's engine on the first request, so that the model cannot choose an inapplicable MV or MZ operation.
5. As a developer selecting an invalid or ambiguous workspace, I want startup to fail before a server begins and identify the conflicting or missing direct-child markers, so that the product never guesses which engine can write my project.
6. As an MZ developer, I want engine-appropriate authoring guidance and truthful capability copy, so that unsupported MZ Playtest or MV-only behavior is not presented as available.
7. As a maintainer, I want a prioritized Redseb enhancement document with provenance and upstream boundaries, so that future fork work can borrow useful ideas without importing another project's architecture or technical debt.

## Delivery Boundary

This spec is implemented and reviewed as one PR. It may be decomposed into multiple tickets on the same branch when that makes execution easier.

## Implementation Decisions

- Keep **RPG Maker Agent** as the user-visible brand. Preserve the existing program/data directory names, release archive name, Start Menu identity, and documented installed paths. Update only active user-facing and preset copy that incorrectly promises MV-only behavior; historical research and archived specs remain historical.
- Define two workspace engines, `mv` and `mz`. Canonicalize `session.header.cwd` and inspect direct children only. MV requires `Game.rpgproject`, `data`, and `js`; MZ requires `game.rmmzproject`, `data`, and `js`. A workspace with both engine markers fails as ambiguous. A workspace with neither marker or missing required directories fails with an engine-neutral message listing the expected direct-child markers. Do not search parents or read workspace-authored MCP configuration.
- Resolve the engine once for each Agent initialization. Marker changes do not retarget a live Agent or warm server; the user starts a new Agent/session after changing the project type. This prevents one capability from changing its tool contract after prompt assembly.
- Change the Host single-flight cache key and deterministic private server identity from canonical workspace alone to `(engine, canonical workspace)`. Same-engine Agents in one workspace reuse one child; different pairs receive different definitions and processes within the existing single MCPorter Runtime. Cancellation closes only the selected pair's child; Host shutdown closes both engines' children.
- Generalize the fixed server definition behind the two engine records rather than adding a generic provider framework. Each record owns its engine id, marker, exact package/version, executable resolution, argv/environment contract, and pinned tool manifest. MV continues to invoke Xerolo with `--project <canonical>`; MZ invokes the Redseb entry with cwd at the canonical project and `RPGMAKER_PROJECT_PATH=<canonical>` in the fixed child environment. No executable, cwd, environment, package, engine, or server definition is model-supplied.
- Keep the current credential-neutralization policy for both children. Add only the selected MZ project-path variable after neutralization. No runtime package installation, network fetch, `.env` discovery, or workspace MCP configuration occurs when an Agent starts.
- Install both exact packages in the existing app-owned MCP runtime during installation/repair. Replace Xerolo-specific runtime preparation terminology and internal environment wiring with one generic RPG Maker MCP runtime; do not migrate its on-disk directory. Verify each package's exact version, bin entry, npm integrity, and installed entrypoint before an atomic runtime swap. A missing or tampered engine package fails installation/repair and Doctor reports that engine independently.
- Ship one generated, digest-pinned manifest per exact server version. The manifest is the source of truth for raw tool names, descriptions, and input schemas; preserve those raw schemas for digest and exact live `tools/list` parity. Project raw input schemas once onto the official DSH-supported object-schema subset for model registration and Code Mode rendering, and verify every projected schema, valid model-facing name, critical engine capability, and exact live `tools/list` parity before tool execution. Keep MV's existing critical editing/backup/validation/Playtest checks. MZ requires project targeting, representative database/map/event/tile writes, `dryRun`, and project/reference validation capabilities; it does not require Playtest tools.
- Continue using stable model-facing names `rpgmaker_<raw name>`. Tool-name overlap across engines is safe because registrations remain Agent-scoped and only one engine manifest is registered for that Agent. Do not add engine prefixes, hashes, session ids, compatibility aliases, a lowest-common-denominator facade, or the union of both engine tool sets.
- Use the official Agent-scoped Code Mode seam to preserve an exact first-request surface. The access layer waits for the first `system-prompt/assemble`, reads the actual Agent workspace, classifies the engine, verifies that engine's manifest, registers exactly that manifest through the Agent scope, acquires and validates the pair server, and then continues prompt assembly. DSH rc.8's lazy `tools:sdk` section must render the newly registered exact set in that same first assembly. Tool execution awaits the same Agent-keyed single-flight initialization. Initialization failure stays failed for that Agent and Host generation rather than degrading to an incomplete or union tool set.
- Keep one generated registration factory and one MCP forwarding path shared by both engines. The factory uses the selected manifest description/schema, forwards by raw tool name to the selected pair server, preserves current result normalization and error behavior, and uses the current fixed MCPorter call timeout and cancellation containment.
- Preserve MV's observable tool names, schemas, server argv, pooled lifecycle, validation, backup/restore, and Playtest behavior. Existing MV skills and Playtest discovery remain MV-specific where the engine contract requires it.
- Add one repository-owned MZ authoring skill for the main RPG Maker preset. It teaches project verification, targeted reads, `dryRun` before material writes, mutation, targeted reread, `validate_project`, and `validate_references`, plus editor sole-writer guidance and Redseb map/autotile/event-command usage. Write it against the pinned tool manifest; do not install the upstream Claude plugin or copy its tileset-catalog runtime assets.
- Make the main RPG Maker preset and shared image/game-design guidance engine-neutral where behavior is shared, with engine-specific references disclosed through the MV and MZ skills. The MZ path must not claim Playtest launch/log/status/stop, screenshots, runtime input, or build-release support. The Playtest Debug preset reports MZ as unsupported rather than starting an MV runtime. MZ packaging/build automation remains outside this PR.
- Update active README, user guide, Windows release/Doctor descriptions, preset metadata/persona copy, and bundle documentation to describe workspace-selected MV/MZ editing while preserving the visible RPG Maker Agent name. Do not rewrite archived specs or historical selection reports except for direct links to the new current design where useful.
- Add a dedicated future-enhancement document for a possible Redseb fork. Prioritize: MZ Playtest lifecycle compatible with the existing harness; atomic per-file writes and explicit multi-file transaction/rollback boundaries; runtime logs/screenshots/controlled input; bulk/localization workflows; and smaller stable result payloads. For each item record user value, prerequisite/risks, an observable acceptance target, upstream-versus-product ownership, and reference provenance. Use Zagos/Newton only as source-reading references; reimplement accepted behavior within Redseb's registry/validation/dry-run structure. Default to upstream contributions, with DSH workspace/manifest/Windows-harness integration retained here.
- Land the current MZ MCP selection research alongside the enhancement document so the chosen fixed point, rejected alternatives, and borrowed-idea provenance are reviewable in the same PR. These are human research records, not runtime sources of truth.
- Update third-party notices for Redseb's MIT package and any redistributed generated metadata. Do not vendor another candidate or publish a fork in this PR.

## Testing Decisions

- Extend the disposable workspace validator seam with representative MV, MZ, missing-marker, missing-directory, and dual-marker workspaces. Assert the selected engine and actionable failure without inspecting private helper shape.
- At the app-owned runtime seam, prove installation/repair and Doctor independently verify both exact packages, bin entries, lock integrities, and entrypoints in the unchanged runtime directory. Use fake package runners and test-owned roots; ordinary tests must not contact npm or a live installation.
- Extend the deterministic MCP fixture so it can expose either pinned manifest and record engine, project root, environment, calls, starts, and stops. Prove the server definition for each engine uses only fixed app-owned commands and the canonical workspace, and that secrets/ambient `DSH_*` values do not reach either child.
- At the Host seam, retain the existing two-workspace MV coverage, add concurrent Agents sharing one MZ pair, and add one mixed MV/MZ case. Prove one MCPorter Runtime owns one child per `(engine, canonical workspace)`, same-pair Agents share it, different pairs remain isolated, cancellation closes only its pair, and Host shutdown leaves no child.
- At the real DSH Agent assembly seam, mount one MV Agent and one MZ Agent concurrently. On each first assembly, assert the exact pinned engine tool names and schemas appear in `tools:sdk`, the other engine's unique tools are absent, no pair identity enters model-facing names, and representative calls route to the correct fixture child. Assert invalid and ambiguous workspaces fail before child registration. This is the highest automated seam for dynamic registration.
- Retain MV mutation/isolation coverage and add one disposable MZ end-to-end editing slice through the generated DSH tool: read project identity, preview a targeted change with `dryRun`, commit it, reread it, then run project/reference validation. The fixture owns every file and process.
- Validate the raw MZ manifest mechanically, project its inputs through the official DSH schema assertion, and compare a fixture `tools/list` response against the unchanged raw contract. Manifest-generation tests may use captured exact-package data; routine tests do not install or execute an external package. Updating either server pin requires an explicitly regenerated manifest and focused disposable probe.
- Test the MZ authoring skill as a mounted, discoverable machine-consumed artifact and verify the appropriate MV/MZ skill roster. Do not test prose text. Test active preset metadata and documentation only where parsed or machine-consumed; ordinary copy changes need no source-shape tests.
- Extend release ZIP/install tests to prove both packages, both manifests, the MZ skill, notices, and engine-neutral active configuration are present. Do not run a real installation, native Windows hardware gate, real DSH/MCP package download, or clean-machine acceptance unless the user separately authorizes that exact expensive gate.
- Run the smallest focused Bun tests during implementation, then `bun test`, `bun run check`, and `git diff --check`. The existing real `phase*:real` and Windows gates remain unrun and are reported as unverified.

## Estimated Changed LOC

- Product code and app-owned bundle: 700–1,200 changed LOC.
- Tests and disposable fixtures: 900–1,500 changed LOC.
- Configuration, skills, notices, and current documentation: 350–650 changed LOC.
- Total excluding generated manifests and lockfiles: 1,950–3,350 changed LOC.

The estimate assumes the current Host/MCPorter pooling, result normalization, runtime staging, release seams, and Code Mode presentation are generalized in place; Redseb itself is not forked or vendored. The generated 119-tool manifest is intentionally excluded from the estimate.

## Out of Scope

- MZ Playtest launch/status/log/stop, runtime bridge, screenshots, gameplay input, or behavioral automation.
- MZ build/package/release automation and clean-machine MZ installation gates.
- Forking, publishing, or modifying Redseb in this PR.
- Importing Zagos, Newton, a951, or their companion plugins.
- Automatic engine conversion, MV/MZ coexistence in one workspace, parent-directory discovery, or changing a live Agent's engine.
- Renaming or migrating installed program/data directories, release archive identity, or persisted user state.
- A common cross-engine tool abstraction, manual wrappers for 160 tools, dynamic npm installation, or user-configurable MCP servers.
- Concurrent-writer locking or editor synchronization. The Agent/MCP remains the sole writer; an open editor is read-only and must not save.
- Running expensive real-package, native Windows, or clean-machine acceptance gates without separate authorization.

## Further Notes

- The selected MZ package and alternative-source review are recorded in `docs/research/rpgmaker-mz-mcp-selection.md`. That note is orientation evidence; the pinned generated manifest and runtime verification are the machine-consumed contract.
- Current DSH rc.8 documentation states that Agent-scoped registrations are disposed with `Agent.ctx`, Code Mode's `tools:sdk` section lazily renders the calling scope's visible capabilities during assembly, and an assembly listener may authoritatively change registry contributions. The real DSH Agent test must prove same-first-request registration before this implementation is accepted.
- Existing installed users are external consumers of the current directory and Start Menu identity. Preserving those paths avoids turning dual-engine support into an unrelated migration; no old/new runtime compatibility layer is required inside the atomically replaced app-owned tree.

## Whole-spec review remediation (2026-08-29)

Status: implemented; deterministic review blockers closed.

- [x] MZ Code Mode now keeps only native `run_code` in the assembly tool list and renders the selected typed SDK/instructions through the official `@deepseek-ai/dsh-tools` contract on that same first assembly; MV retains its existing surface.
- [x] MZ `set_project` cannot retarget the acquired `(engine, canonical workspace)` pair, and one Host test mounts MV and MZ Agents concurrently with isolated pair state and tool presentations.
- [x] The approval-gated real acceptance script has a dual-mount, one-Host probe; the real and Windows gates remain intentionally unrun.
- [x] Active branding and quick-start prompts are workspace/engine-neutral, with runtime assertions covering the absence of MV-only prompt claims.
- [x] Repo-owned legacy aliases, overloads, single-engine staging, and compatibility fixtures were removed; owned installation fakes cover exact MV/MZ package install, repair, and reuse.
- [x] Public doctor and RPG Maker callback/result shapes use explicit exported interfaces.
- [x] The private workspace bundle no longer carries an internal SHA-256 pin or profile hash validation; third-party package and manifest integrity pins remain authoritative.

## Second full re-review remediation (2026-08-29)

Status: implemented; the official DSH schema and pair-identity blockers are closed.

- [x] One recursive model-facing projection removes unsupported upstream JSON-Schema vocabulary (including `$schema`, numeric bounds, and property-name constraints), preserves object/array/scalar structure and annotations, and validates every projected MZ input schema with the official `assertObjectJsonSchema`. `createMcpTool` and the Code Mode `renderToolsSdk` path use the same projection; official renderer coverage proves typed nested `update_actor`, `update_map_event`, and `paint_tiles` arguments rather than `unknown`.
- [x] MZ `set_project` canonicalizes its argument, forwards an alias resolving to the acquired canonical workspace, and rejects a different canonical target without changing the `(engine, canonical workspace)` pair.
- [x] The real-acceptance helper's dual-mount branch is consistently reindented; focused runtime tests no longer inspect client source text, and the generated MZ interface declaration has the required semicolon.
- [x] The MV Help guidance is scoped to the MV skill, active Forgejo reporting copy uses **RPG Maker Agent**, and unused observation/private-bundle/RPG Maker engine aliases are removed from owned code and declarations.

## Final full-review remediation (2026-08-29)

Status: implemented; final deterministic blockers are closed.

- [x] Model-schema projection now fails closed: official `assertObjectJsonSchema` errors propagate instead of being replaced by an empty schema. The hostile-schema regression proves initialization/registration cannot silently advertise no arguments, while all 119 MZ projections remain officially valid.
- [x] Shared plugin guidance is engine-neutral. MV retains its `js/rpg_*.js`, ES5, MV/NW.js, and `fs` rules in the MV skill; MZ now directs authors to `js/rmmz_*.js` and the pinned MZ runtime's actual JavaScript/file-API expectations. The **RPG Maker Agent** brand is preserved.
- [x] Private contract APIs require an explicit `mv` or `mz` engine. Manifest-object inference and default-to-MV overloads were removed from `contract.js`/`.d.ts`, and `createMcpTool` rejects a missing/invalid engine; all owned callers, generators, and tests pass the engine explicitly.
