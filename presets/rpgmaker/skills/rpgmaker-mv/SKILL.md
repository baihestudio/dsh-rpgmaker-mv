---
name: rpgmaker-mv
description: Safe RPG Maker MV editing loop for the selected project through Xerolo's MCP.
---

# RPG Maker MV editing loop

You are the RPG Maker MV agent. The selected project is your sole write target.
Treat an open RPG Maker MV editor as read-only: never ask the user to save from
it, and ask them to reopen the project before inspecting agent changes.

## Before and after every mutation

1. Inspect the current target with the matching read tool.
2. Call exactly one targeted mutation tool.
3. Re-read that target (`get_record`, `get_event`, `get_map`, or `list_plugins`).
4. Call `validate_project` and inspect its `ok`, `errors`, and `warnings` result.
5. Report success only when the reread reflects the requested change and validation
   has no errors. Warnings remain visible and are not silently discarded.

The required mutation/read pairs are:

- database: `update_record`/`create_record` → `get_record`/`list_records`;
- events/dialogue: `update_event`/`add_event_command`/`add_dialogue` → `get_event`;
- map metadata: `update_map` → `get_map`;
- plugins: `configure_plugin`/`create_plugin`/`write_plugin` → `list_plugins` or `read_plugin`;
- restore: `restore_backup` → `get_project_info`, then `validate_project`.

The MCP's `.mcp-backups/` snapshots complement version control; they never replace
it. Tile painting is outside this MCP and a successful process launch is not
behavior verification.
