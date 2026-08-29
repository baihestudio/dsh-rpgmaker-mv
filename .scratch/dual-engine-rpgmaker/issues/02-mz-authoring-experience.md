# 02 — MZ authoring experience and enhancement roadmap

**What to build:** An MZ developer receives engine-appropriate guidance for the complete safe editing loop, while active RPG Maker Agent copy remains engine-neutral and a dedicated roadmap records the strongest future Redseb enhancements and their provenance.

**Blocked by:** 01 — Workspace-selected MV/MZ editing loop.

Status: done

- [x] A repository-owned MZ authoring skill is mounted and discoverable, directs the Agent through targeted read, `dryRun`, mutation, reread, project/reference validation, and editor sole-writer behavior, and covers Redseb map/autotile/event-command workflows without installing the upstream Claude plugin.
- [x] The main preset and shared current guidance describe MV/MZ behavior truthfully while retaining the existing **RPG Maker Agent** brand and installed-path identity.
- [x] MV-specific guidance remains available for MV; an MZ Playtest Debug request reports the unsupported capability instead of launching MV, and no active copy claims MZ runtime, screenshot, input, or build-release support.
- [x] A disposable MZ editing scenario completes identity read, dry-run preview, committed targeted change, reread, `validate_project`, and `validate_references` through generated DSH tools.
- [x] The existing MZ selection research lands in the PR, and a separate future-fork document prioritizes Playtest/runtime lifecycle, atomic and transactional writes, logs/screenshots/input, bulk/localization, and compact results with value, risks, acceptance target, provenance, and upstream/product ownership for every item.
- [x] Machine-consumed preset and skill artifacts parse and mount successfully; tests assert their contracts and roster rather than prose wording.

## Whole-spec review remediation (2026-08-29)

- [x] Plugin, dialogue, and image quick starts now describe the workspace-selected engine rather than hard-coding RPG Maker MV; runtime assertions cover the active prompts.

## Second full re-review remediation (2026-08-29)

- [x] MV Help-only instructions live in the MV-specific skill, while shared game-design guidance remains engine-neutral.
- [x] Active shared Forgejo reporting skills use the current **RPG Maker Agent** product name; historical research remains unchanged.

## Final full-review remediation (2026-08-29)

- [x] Shared plugin guidance is engine-neutral; MV-only `js/rpg_*.js`, ES5, MV/NW.js, and `fs` instructions remain in the MV skill, and the MZ skill now names `js/rmmz_*.js` plus the pinned MZ runtime's actual JavaScript/file-API expectations. The active product brand remains **RPG Maker Agent**.
