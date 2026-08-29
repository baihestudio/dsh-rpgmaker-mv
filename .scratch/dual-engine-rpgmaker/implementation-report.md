# Dual-engine RPG Maker implementation report

## Status

Complete. The ready whole-spec implementation was delivered in dependency
order: ticket 01 (workspace-selected engine and pooled MCP loop), ticket 02 (MZ
authoring guidance and roadmap), then ticket 03 (Windows delivery and Doctor /
release coverage). No per-ticket owner acceptance was used.

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
- The generated MV (41 tools) and Redseb MZ (119 tools) manifests are digest
  pinned. Schema, identity, name, critical-capability, and live `tools/list`
  drift fail closed before execution. Stable model names remain
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

## Changed-LOC variance

Measured from the staged diff, excluding the generated 119-tool MZ manifest and
its declaration file (and excluding lockfiles):

| Category | Additions | Deletions | Changed |
| --- | ---: | ---: | ---: |
| Product code, app-owned bundle, and scripts | 1,036 | 304 | 1,340 |
| Tests and disposable fixtures | 317 | 11 | 328 |
| Configuration, skills, notices, and current documentation | 297 | 61 | 358 |
| Scratch spec/ticket state | 129 | 0 | 129 |
| **Total implementation diff** | **1,779** | **376** | **2,155** |

These are staged `numstat` totals before adding this report, excluding the
generated MZ manifest/declaration and lockfiles. Excluding the 129 lines of
scratch spec/ticket bookkeeping leaves 2,026 changed lines, within the spec's
1,950–3,350 estimate; including the required status updates remains within the
same range.

## Verification evidence

- `bun test tests/phase10.test.ts tests/phase12.test.ts tests/phase7.test.ts` —
  65 passed, 0 failed (561 expect calls), including the disposable MZ Agent
  identity → dry-run → commit → reread → `validate_project` /
  `validate_references` scenario.
- `bun test` — 106 passed, 0 failed (744 expect calls).
- `bun run check` — passed (`tsc --noEmit`).
- `git diff --check` — passed.
- Bundle contract probe — MZ manifest has 119 tools, `verifyManifest('mz')`
  returns no errors, and its digest is
  `d3409ee3f4181875042020b593a488a6b5f102e9e6c50f3ef4f05b4299e83658`.
- Shipped workspace bundle digest —
  `d790562f419914fc68ecff50376bf66ea789f4e9b069fedb010dadfabe8f8000`.

The real package-download `phase*:real` gates, native Windows/clean-machine
installed gate, deployment, and code review were not run: they are explicitly
outside this request or require separate expensive-gate authorization. The
ordinary suite uses only disposable roots, fixtures, fake runners, and child
processes.
