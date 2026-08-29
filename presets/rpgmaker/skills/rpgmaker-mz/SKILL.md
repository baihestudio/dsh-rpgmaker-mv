---
name: rpgmaker-mz
description: Safe RPG Maker MZ authoring loop for the selected DSH Web workspace through the pinned Redseb MCP tools.
---

# RPG Maker MZ editing loop

Use the selected DSH Web workspace as the only project target. The workspace
engine is selected from its direct-child `game.rmmzproject`, `data`, and `js`
markers; do not infer a project from a parent directory or from MCP settings.
The Redseb `rpgmaker-mz-mcp@1.3.0` tools are the source of truth for MZ data,
maps, events, tiles, plugins, and validation.

## Safe authoring sequence

Before editing an MZ plugin, inspect the selected project's `js/rmmz_*.js`
core scripts and the pinned MZ runtime's actual JavaScript and file-API
expectations. Use only APIs and syntax those files and that runtime
demonstrate; do not apply MV/NW.js or ES5-only assumptions.

Before a material change:

1. Read project identity with `rpgmaker_get_project` and inspect the smallest
   relevant target (`rpgmaker_get_database`, a targeted `rpgmaker_get_map`,
   `rpgmaker_get_map_event`, or the matching record/search tool).
2. Preview exactly one targeted mutation with `dryRun: true`. Review the
   returned file diff and warnings; do not use `force` to bypass structural
   validation unless the user explicitly chooses that risk.
3. Repeat the same mutation without `dryRun` only after the preview is
   acceptable.
4. Re-read the changed target and confirm the requested value, event command,
   map tree, tile, or reference is present.
5. Call `rpgmaker_validate_project`, then `rpgmaker_validate_references`.
   Report warnings separately and report success only when both checks have no
   errors.

Keep the MZ editor closed while the Agent writes. If it is open, treat it as a
read-only reference and ask the user to reopen it after the reread/validation
loop. The Agent/MCP is the sole writer; do not have another Agent save the same
project concurrently.

## MZ-specific workflows

- **Maps:** use `rpgmaker_get_map_infos`/`rpgmaker_get_map` for targeted reads,
  `rpgmaker_create_map`, `rpgmaker_update_map`, `rpgmaker_update_map_tree`,
  `rpgmaker_resize_map`, and `rpgmaker_set_encounters` for metadata. Re-read
  the map and tree after a write.
- **Events and commands:** inspect the page with `rpgmaker_get_map_event`, use
  the Redseb builders such as `rpgmaker_build_show_text`,
  `rpgmaker_build_show_choices`, `rpgmaker_build_conditional_branch`, and
  `rpgmaker_build_flow_command`, then add or replace commands with
  `rpgmaker_add_event_command`, `rpgmaker_insert_event_commands`, or
  `rpgmaker_set_event_page`. Let command arity/block validation run; use
  `force` only when an explicit, reviewed exception is required.
- **Tiles and autotiles:** use `rpgmaker_get_tile_catalog`/`rpgmaker_find_tile`
  to resolve semantic tile ids, then preview `rpgmaker_set_map_tile`,
  `rpgmaker_paint_tiles`, `rpgmaker_fill_area`, or `rpgmaker_place_object`.
  Re-read the map tile data and run both validations. `describe_tile`,
  `get_tile_flags`, and `check_passability` help explain autotile and
  passability choices; do not guess raw ids.
- **Database and plugins:** use the matching `search_*`, `create_*`, and
  `update_*` tools for records, and `rpgmaker_scan_plugins`/the plugin tools for
  static plugin metadata. Plugin scanning is not Playtest and cannot prove
  runtime behavior.

MZ Playtest launch/status/log/stop, screenshots, runtime input, and build or
release packaging are not capabilities of this engine path. Report them as
unsupported and do not call MV Playtest tools. A successful MCP response is
not behavioral or visual verification.
