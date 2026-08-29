# Dual-engine RPG Maker implementation report

## Status

Complete. The ready whole-spec implementation was delivered in dependency
order: ticket 01 (workspace-selected engine and pooled MCP loop), ticket 02 (MZ
authoring guidance and roadmap), then ticket 03 (Windows delivery and Doctor /
release coverage). The deterministic whole-spec review remediation is also
closed. No per-ticket owner acceptance was used.

The visible product remains **RPG Maker Agent** and the existing Windows
program/data paths and archive identity are unchanged. The checked-in MZ
selection research and enhancement roadmap are included with the implementation.

## Completed acceptance criteria

- Direct-child `Game.rpgproject` / `game.rmmzproject` classification now selects
  MV or MZ, rejects missing/incomplete and ambiguous roots, never searches
  parents, and never retargets a live Agent.
- One app-owned runtime stages and verifies both exact MCP packages, versions,
  bin entries, lockfile integrities, package identities, and contained
  entrypoints before an atomic swap. Doctor exposes aggregate plus independent
  MV and MZ health checks.
- The Host cache is keyed by `(engine, canonical workspace)` and keeps one
  pooled child per pair, with pair-scoped cancellation and complete Host
  shutdown cleanup.
- The generated MV (41 tools) and Redseb MZ (119 tools) manifests remain pinned
  to their exact package contracts. Schema, identity, name,
  critical-capability, and live `tools/list` drift fail closed before
  execution. Stable model names remain
  `rpgmaker_<raw-name>`.
- First Agent assembly waits for workspace discovery and exposes exactly the
  selected engine surface. MV keeps Xerolo's `--project` invocation and
  Playtest contract; MZ uses canonical cwd plus fixed
  `RPGMAKER_PROJECT_PATH` and intentionally has no Playtest/runtime/build
  surface.
- The repository-owned MZ authoring skill covers targeted reads, `dryRun`,
  commit, reread, project/reference validation, editor sole-writer behavior,
  maps/autotiles/events/tiles/plugins, and explicit unsupported capabilities.
- Active README, user guide, Windows documentation, preset metadata/persona,
  Playtest guidance, bundle documentation, release inspection, third-party
  notices, and the MZ selection/roadmap records describe the dual-engine
  behavior truthfully.

## Whole-spec review remediation

- P0 Code Mode: MZ assembly retains only native `run_code` and uses the
  official `@deepseek-ai/dsh-tools` renderer for a complete typed
  `ToolArgsMap`/`tools` SDK on the same first assembly; MV behavior is
  preserved. The disposable Agent harness and phase 12 tests assert the
  native surface, typed SDK, and absence of MV-only names.
- P0 pair isolation: MZ `set_project` rejects retargeting and the same-Host
  concurrency test proves separate MV/MZ pair keys, tool sets, and state.
- P1 concurrency: the approval-gated real acceptance script now contains a
  one-Host dual-mount probe; it was not run.
- P1 branding: active plugin, dialogue, and image quick starts are
  workspace-selected and engine-neutral, with runtime assertions.
- Compatibility cleanup: repo-owned legacy aliases, overloads, fallback
  verifier paths, and single-engine staging fixtures were removed. Owned
  fakes cover exact MV/MZ install, repair, and verified reuse.
- Public contracts: Doctor callback results and RPG Maker script/engine
  verification maps use explicit exported interfaces.
- Internal bundle hashing: `WORKSPACE_MCP_SHA256`,
  `workspaceMcpBundleDigest`, `DesiredPackage.sha256`, profile hash validation,
  and both generator rewrite steps were removed. Redseb, Xerolo, and Forgejo
  third-party integrity pins remain.

## Changed-LOC variance

The original whole-spec implementation was already within its estimated
1,950–3,350 changed lines. This review-remediation follow-up is a focused
staged diff of 558 additions and 445 deletions (including scratch bookkeeping,
docs, and lockfile updates); it does not add generated manifests or a private
workspace bundle hash artifact.

## Verification evidence

- `bun test tests/phase10.test.ts tests/phase12.test.ts tests/phase7.test.ts` —
  66 passed, 0 failed (582 expect calls), including the disposable MZ Agent
  identity → dry-run → commit → reread → `validate_project` /
  `validate_references` scenario.
- `bun test` — 107 passed, 0 failed (764 expect calls).
- `bun run check` — passed (`tsc --noEmit`).
- `git diff --check` — passed.
- Bundle contract probe — MZ manifest has 119 tools, `verifyManifest('mz')`
  returns no errors, and its digest is
  `d3409ee3f4181875042020b593a488a6b5f102e9e6c50f3ef4f05b4299e83658`.
The real package-download `phase*:real` gates, native Windows/clean-machine
installed gate, deployment, and code review were not run: they are explicitly
outside this request or require separate expensive-gate authorization. The
ordinary suite uses only disposable roots, fixtures, fake runners, and child
processes.
