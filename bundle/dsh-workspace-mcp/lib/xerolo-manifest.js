/**
 * GENERATED FILE — do not edit by hand.
 * Machine-generated from tools/list of @xerolo44/rpgmaker-mv-mcp@0.1.0.
 * Regenerate with: bun run scripts/generate-xerolo-manifest.ts
 */
export const XEROLO_MANIFEST = {
  "package": "@xerolo44/rpgmaker-mv-mcp",
  "version": "0.1.0",
  "tools": [
    {
      "name": "set_project",
      "description": "Select the RPG Maker MV project folder to work on (the folder containing Game.rpgproject and data/). Must be called before other tools unless the server was started with --project.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "Absolute path to the RPG Maker MV project folder"
          }
        },
        "required": [
          "path"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "get_project_info",
      "description": "Summary of the current project: game title, database record counts, map count, and plugin count.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "list_records",
      "description": "List all records of a database type as {id, name} summaries. Use get_record for full data.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "actors",
              "classes",
              "skills",
              "items",
              "weapons",
              "armors",
              "enemies",
              "troops",
              "states",
              "animations",
              "tilesets",
              "commonEvents"
            ],
            "description": "Which database to access (e.g. actors, items, skills, troops, commonEvents)"
          }
        },
        "required": [
          "type"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "get_record",
      "description": "Get the full JSON of one database record by id.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "actors",
              "classes",
              "skills",
              "items",
              "weapons",
              "armors",
              "enemies",
              "troops",
              "states",
              "animations",
              "tilesets",
              "commonEvents"
            ],
            "description": "Which database to access (e.g. actors, items, skills, troops, commonEvents)"
          },
          "id": {
            "type": "integer",
            "minimum": 1,
            "description": "Record id (1-based)"
          }
        },
        "required": [
          "type",
          "id"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "update_record",
      "description": "Update a database record. By default the given fields are shallow-merged into the existing record; set merge=false to replace it entirely. The record's id always stays fixed to match its array position.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "actors",
              "classes",
              "skills",
              "items",
              "weapons",
              "armors",
              "enemies",
              "troops",
              "states",
              "animations",
              "tilesets",
              "commonEvents"
            ],
            "description": "Which database to access (e.g. actors, items, skills, troops, commonEvents)"
          },
          "id": {
            "type": "integer",
            "minimum": 1,
            "description": "Record id (1-based)"
          },
          "data": {
            "type": "object",
            "additionalProperties": {},
            "description": "Fields to set (or the complete record when merge=false)"
          },
          "merge": {
            "type": "boolean",
            "default": true,
            "description": "Merge into existing record (true) or replace (false)"
          }
        },
        "required": [
          "type",
          "id",
          "data"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "create_record",
      "description": "Append a new record to a database. The new record's fields are copied from `data`; missing fields should be filled in to match the shape of existing records (fetch one with get_record as a template first). Returns the new id.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "actors",
              "classes",
              "skills",
              "items",
              "weapons",
              "armors",
              "enemies",
              "troops",
              "states",
              "animations",
              "tilesets",
              "commonEvents"
            ],
            "description": "Which database to access (e.g. actors, items, skills, troops, commonEvents)"
          },
          "data": {
            "type": "object",
            "additionalProperties": {},
            "description": "The record fields (id is assigned automatically)"
          }
        },
        "required": [
          "type",
          "data"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "get_system",
      "description": "Read System.json (game title, starting party/position, terms, sounds, switches, variables, etc.). Optionally return only one top-level key.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "key": {
            "type": "string",
            "description": "Optional top-level key to return (e.g. 'switches', 'variables', 'terms')"
          }
        },
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "set_switch_name",
      "description": "Set the editor name of a game switch in System.json (e.g. switch 5 = 'Opened Chest'). The switches array grows if the id is beyond its current size.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "minimum": 1,
            "description": "Switch id (1-based)"
          },
          "name": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "name"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "set_variable_name",
      "description": "Set the editor name of a game variable in System.json (e.g. variable 3 = 'Quest Progress'). The variables array grows if the id is beyond its current size.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "minimum": 1,
            "description": "Variable id (1-based)"
          },
          "name": {
            "type": "string"
          }
        },
        "required": [
          "id",
          "name"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "update_system",
      "description": "Shallow-merge the given top-level fields into System.json (e.g. gameTitle, startMapId, startX, startY, switches, variables).",
      "inputSchema": {
        "type": "object",
        "properties": {
          "data": {
            "type": "object",
            "additionalProperties": {},
            "description": "Top-level System.json fields to set"
          }
        },
        "required": [
          "data"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "list_maps",
      "description": "List all maps from MapInfos.json as {id, name, parentId, order}.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "get_map",
      "description": "Read a map's properties (size, tileset, music, encounters, notes) and event summaries. Tile data is omitted unless includeTileData=true (it is large: width*height*6 integers).",
      "inputSchema": {
        "type": "object",
        "properties": {
          "mapId": {
            "type": "integer",
            "minimum": 1
          },
          "includeTileData": {
            "type": "boolean",
            "default": false
          }
        },
        "required": [
          "mapId"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "update_map",
      "description": "Shallow-merge fields into a map's JSON (e.g. displayName, note, bgm, encounterList). Refuses to touch 'data' or 'events' — use dedicated event tools; tile editing is not supported.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "mapId": {
            "type": "integer",
            "minimum": 1
          },
          "data": {
            "type": "object",
            "additionalProperties": {},
            "description": "Map property fields to set"
          }
        },
        "required": [
          "mapId",
          "data"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "get_event",
      "description": "Get the full JSON of one event on a map, including all pages and command lists.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "mapId": {
            "type": "integer",
            "minimum": 1
          },
          "eventId": {
            "type": "integer",
            "minimum": 1
          }
        },
        "required": [
          "mapId",
          "eventId"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "update_event",
      "description": "Replace an event on a map with the given event JSON (same shape as returned by get_event). The event's id and its array position stay in sync automatically. See event_command_reference for command codes.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "mapId": {
            "type": "integer",
            "minimum": 1
          },
          "eventId": {
            "type": "integer",
            "minimum": 1
          },
          "event": {
            "type": "object",
            "additionalProperties": {},
            "description": "Complete event object (name, x, y, note, pages)"
          }
        },
        "required": [
          "mapId",
          "eventId",
          "event"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "create_event",
      "description": "Add a new event to a map at (x, y). If no pages are given, a single empty page (action-button trigger, no commands) is created. Returns the new event id.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "mapId": {
            "type": "integer",
            "minimum": 1
          },
          "name": {
            "type": "string"
          },
          "x": {
            "type": "integer",
            "minimum": 0
          },
          "y": {
            "type": "integer",
            "minimum": 0
          },
          "note": {
            "type": "string",
            "default": ""
          },
          "pages": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": {}
            },
            "description": "Optional event pages; defaults to one empty page"
          }
        },
        "required": [
          "mapId",
          "name",
          "x",
          "y"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "delete_event",
      "description": "Delete an event from a map. The slot is set to null so other event ids are unaffected (matches editor behavior).",
      "inputSchema": {
        "type": "object",
        "properties": {
          "mapId": {
            "type": "integer",
            "minimum": 1
          },
          "eventId": {
            "type": "integer",
            "minimum": 1
          }
        },
        "required": [
          "mapId",
          "eventId"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "add_event_command",
      "description": "Insert commands into an event page's command list without resending the whole event. Commands are inserted before the page's terminating {code: 0} entry (or at `index` if given). Multi-line constructs work naturally, e.g. Show Text is one code-101 command followed by code-401 commands. See event_command_reference for codes.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "mapId": {
            "type": "integer",
            "minimum": 1
          },
          "eventId": {
            "type": "integer",
            "minimum": 1
          },
          "pageIndex": {
            "type": "integer",
            "minimum": 0,
            "default": 0,
            "description": "Which event page (0-based)"
          },
          "commands": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "integer",
                  "description": "Event command code"
                },
                "indent": {
                  "type": "integer",
                  "minimum": 0,
                  "default": 0
                },
                "parameters": {
                  "type": "array",
                  "items": {},
                  "default": []
                }
              },
              "required": [
                "code"
              ],
              "additionalProperties": false
            },
            "minItems": 1,
            "description": "Commands to insert, in order"
          },
          "index": {
            "type": "integer",
            "minimum": 0,
            "description": "Position in the list to insert at; defaults to the end (before the terminator)"
          }
        },
        "required": [
          "mapId",
          "eventId",
          "commands"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "add_dialogue",
      "description": "Add spoken dialogue to an event page in one call — builds the Show Text (101) and text-line (401) commands automatically, splitting into multiple message boxes every 4 lines. Inserted before the page's end, like add_event_command.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "mapId": {
            "type": "integer",
            "minimum": 1
          },
          "eventId": {
            "type": "integer",
            "minimum": 1
          },
          "pageIndex": {
            "type": "integer",
            "minimum": 0,
            "default": 0
          },
          "lines": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "minItems": 1,
            "description": "Dialogue lines (a new message box starts every 4 lines)"
          },
          "faceName": {
            "type": "string",
            "default": "",
            "description": "Face image file (e.g. 'Actor1'), empty for none"
          },
          "faceIndex": {
            "type": "integer",
            "minimum": 0,
            "maximum": 7,
            "default": 0
          },
          "background": {
            "type": "integer",
            "minimum": 0,
            "maximum": 2,
            "default": 0,
            "description": "0 window, 1 dim, 2 transparent"
          },
          "position": {
            "type": "integer",
            "minimum": 0,
            "maximum": 2,
            "default": 2,
            "description": "0 top, 1 middle, 2 bottom"
          }
        },
        "required": [
          "mapId",
          "eventId",
          "lines"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "create_map",
      "description": "Create a new blank map: writes MapXXX.json with empty tile data and registers it in MapInfos.json. Tiles must still be painted in the editor, but events, properties, and everything else can be edited here. Returns the new map id.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "width": {
            "type": "integer",
            "minimum": 1,
            "maximum": 256,
            "default": 17
          },
          "height": {
            "type": "integer",
            "minimum": 1,
            "maximum": 256,
            "default": 13
          },
          "tilesetId": {
            "type": "integer",
            "minimum": 1,
            "default": 1
          },
          "parentId": {
            "type": "integer",
            "minimum": 0,
            "default": 0,
            "description": "Parent map id in the editor tree (0 = top level)"
          }
        },
        "required": [
          "name"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "event_command_reference",
      "description": "Reference table of RPG Maker MV event command codes and their parameters. Consult this before writing or editing event command lists.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "list_plugins",
      "description": "List all plugins registered in js/plugins.js with status and parameters.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "configure_plugin",
      "description": "Enable/disable a registered plugin and/or merge new values into its parameters (parameter values are always strings in RPG Maker MV).",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "Plugin name as it appears in list_plugins"
          },
          "status": {
            "type": "boolean",
            "description": "true = enabled, false = disabled"
          },
          "parameters": {
            "type": "object",
            "additionalProperties": {
              "type": "string"
            },
            "description": "Parameter values to merge into the plugin's parameters"
          }
        },
        "required": [
          "name"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "add_plugin",
      "description": "Register an existing js/plugins/<name>.js file in the plugin list. Fails if the file does not exist (use create_plugin to make a new one).",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "status": {
            "type": "boolean",
            "default": true
          },
          "description": {
            "type": "string",
            "default": ""
          },
          "parameters": {
            "type": "object",
            "additionalProperties": {
              "type": "string"
            },
            "default": {}
          }
        },
        "required": [
          "name"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "remove_plugin",
      "description": "Remove a plugin from js/plugins.js. The plugin's .js file is NOT deleted.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          }
        },
        "required": [
          "name"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "create_plugin",
      "description": "Create a new plugin file in js/plugins/ and register it. If no code is given, a standard MV plugin scaffold (with @plugindesc header) is written. Fails if the file already exists.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "Plugin file name without .js"
          },
          "description": {
            "type": "string",
            "default": ""
          },
          "code": {
            "type": "string",
            "description": "Full JavaScript source; omit for a scaffold"
          },
          "status": {
            "type": "boolean",
            "default": true
          }
        },
        "required": [
          "name"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "read_plugin",
      "description": "Read the JavaScript source of js/plugins/<name>.js.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          }
        },
        "required": [
          "name"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "write_plugin",
      "description": "Overwrite the JavaScript source of an existing js/plugins/<name>.js.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "code": {
            "type": "string",
            "description": "Complete new file contents"
          }
        },
        "required": [
          "name",
          "code"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "playtest_start",
      "description": "Start a playtest of the current project. mode 'nwjs' launches the game with an NW.js runtime (pass runtimePath, e.g. the Game.exe inside the RPG Maker MV install's nwjs-win folder) and captures its stdout/stderr. mode 'browser' serves the project over a local HTTP server and returns a URL to open. Any previous playtest is stopped first.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "mode": {
            "type": "string",
            "enum": [
              "nwjs",
              "browser"
            ],
            "default": "browser"
          },
          "runtimePath": {
            "type": "string",
            "description": "Path to NW.js executable. If omitted in nwjs mode, common install locations (Steam, KADOKAWA, the project's own Game.exe, $RPGMAKER_MV_NWJS) are probed automatically."
          },
          "port": {
            "type": "integer",
            "minimum": 1024,
            "maximum": 65535,
            "default": 8321,
            "description": "Port for browser mode"
          }
        },
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "playtest_status",
      "description": "Whether a playtest is running, in which mode, and its URL/PID.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "playtest_log",
      "description": "Recent stdout/stderr lines from an NW.js playtest process.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "tail": {
            "type": "integer",
            "minimum": 1,
            "maximum": 500,
            "default": 50,
            "description": "Number of lines from the end"
          }
        },
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "playtest_stop",
      "description": "Stop the running playtest process and/or HTTP server.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "create_damage_skill",
      "description": "Create a complete damaging skill in one call. The formula uses MV damage syntax where `a` is the user and `b` the target, e.g. 'a.mat * 4 - b.mdf * 2' or 'a.atk * 2 - b.def'. Returns the new skill id.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string",
            "default": "",
            "description": "Two-line description shown in menus"
          },
          "mpCost": {
            "type": "integer",
            "minimum": 0,
            "default": 0
          },
          "tpCost": {
            "type": "integer",
            "minimum": 0,
            "default": 0
          },
          "iconIndex": {
            "type": "integer",
            "minimum": 0,
            "default": 0,
            "description": "Icon sheet index"
          },
          "animationId": {
            "type": "integer",
            "minimum": -1,
            "default": 0,
            "description": "Animation id from the Animations database (0 = none, -1 = normal attack)"
          },
          "stypeId": {
            "type": "integer",
            "minimum": 0,
            "default": 1,
            "description": "Skill type id (1 = Magic by default)"
          },
          "occasion": {
            "type": "integer",
            "minimum": 0,
            "maximum": 3,
            "description": "When usable: 0 always, 1 battle only, 2 menu only, 3 never"
          },
          "note": {
            "type": "string",
            "default": ""
          },
          "formula": {
            "type": "string",
            "description": "Damage formula, e.g. 'a.mat * 4 - b.mdf * 2'"
          },
          "damageType": {
            "type": "string",
            "enum": [
              "hp",
              "mp",
              "hp_drain",
              "mp_drain"
            ],
            "default": "hp",
            "description": "What the damage hits (drain variants absorb into the user)"
          },
          "elementId": {
            "type": "integer",
            "minimum": -1,
            "default": 0,
            "description": "Element id from System types (0 = none, -1 = normal attack element)"
          },
          "hitType": {
            "type": "string",
            "enum": [
              "certain",
              "physical",
              "magical"
            ],
            "default": "magical",
            "description": "Hit type (affects evasion/reflection rules)"
          },
          "scope": {
            "type": "integer",
            "minimum": 0,
            "maximum": 11,
            "default": 1,
            "description": "Target scope: 1 one enemy, 2 all enemies, 3-6 random enemies (1-4), 7 one ally, 8 all allies, 9 one dead ally, 10 all dead allies, 11 the user"
          },
          "variance": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100,
            "default": 20,
            "description": "Damage variance %"
          },
          "critical": {
            "type": "boolean",
            "default": true,
            "description": "Can critically hit"
          },
          "tpGain": {
            "type": "integer",
            "minimum": 0,
            "default": 0,
            "description": "TP the user gains on use"
          }
        },
        "required": [
          "name",
          "formula"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "create_healing_skill",
      "description": "Create a complete healing skill in one call. The formula uses MV damage syntax (`a` = user), e.g. 'a.mat * 2 + 200'. Heals HP or MP; optionally also removes states (e.g. a cure spell).",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string",
            "default": "",
            "description": "Two-line description shown in menus"
          },
          "mpCost": {
            "type": "integer",
            "minimum": 0,
            "default": 0
          },
          "tpCost": {
            "type": "integer",
            "minimum": 0,
            "default": 0
          },
          "iconIndex": {
            "type": "integer",
            "minimum": 0,
            "default": 0,
            "description": "Icon sheet index"
          },
          "animationId": {
            "type": "integer",
            "minimum": -1,
            "default": 0,
            "description": "Animation id from the Animations database (0 = none, -1 = normal attack)"
          },
          "stypeId": {
            "type": "integer",
            "minimum": 0,
            "default": 1,
            "description": "Skill type id (1 = Magic by default)"
          },
          "occasion": {
            "type": "integer",
            "minimum": 0,
            "maximum": 3,
            "description": "When usable: 0 always, 1 battle only, 2 menu only, 3 never"
          },
          "note": {
            "type": "string",
            "default": ""
          },
          "formula": {
            "type": "string",
            "description": "Recovery formula, e.g. 'a.mat * 2 + 200'"
          },
          "recoverType": {
            "type": "string",
            "enum": [
              "hp",
              "mp"
            ],
            "default": "hp"
          },
          "scope": {
            "type": "integer",
            "minimum": 0,
            "maximum": 11,
            "default": 7,
            "description": "Target scope: 1 one enemy, 2 all enemies, 3-6 random enemies (1-4), 7 one ally, 8 all allies, 9 one dead ally, 10 all dead allies, 11 the user (default: one ally)"
          },
          "variance": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100,
            "default": 20
          },
          "removeStates": {
            "type": "array",
            "items": {
              "type": "integer",
              "minimum": 1
            },
            "default": [],
            "description": "State ids to remove from the target (100% chance), e.g. poison"
          }
        },
        "required": [
          "name",
          "formula"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "create_buff_skill",
      "description": "Create a skill that applies parameter buffs and/or debuffs. Parameter ids: 0 Max HP, 1 Max MP, 2 Attack, 3 Defense, 4 M.Attack, 5 M.Defense, 6 Agility, 7 Luck. If only debuffs are given the scope defaults to one enemy, otherwise one ally.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string",
            "default": "",
            "description": "Two-line description shown in menus"
          },
          "mpCost": {
            "type": "integer",
            "minimum": 0,
            "default": 0
          },
          "tpCost": {
            "type": "integer",
            "minimum": 0,
            "default": 0
          },
          "iconIndex": {
            "type": "integer",
            "minimum": 0,
            "default": 0,
            "description": "Icon sheet index"
          },
          "animationId": {
            "type": "integer",
            "minimum": -1,
            "default": 0,
            "description": "Animation id from the Animations database (0 = none, -1 = normal attack)"
          },
          "stypeId": {
            "type": "integer",
            "minimum": 0,
            "default": 1,
            "description": "Skill type id (1 = Magic by default)"
          },
          "occasion": {
            "type": "integer",
            "minimum": 0,
            "maximum": 3,
            "description": "When usable: 0 always, 1 battle only, 2 menu only, 3 never"
          },
          "note": {
            "type": "string",
            "default": ""
          },
          "buffs": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "param": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 7,
                  "description": "Parameter id (0-7)"
                },
                "turns": {
                  "type": "integer",
                  "minimum": 1,
                  "default": 5
                }
              },
              "required": [
                "param"
              ],
              "additionalProperties": false
            },
            "default": [],
            "description": "Buffs to add to the target"
          },
          "debuffs": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "param": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 7,
                  "description": "Parameter id (0-7)"
                },
                "turns": {
                  "type": "integer",
                  "minimum": 1,
                  "default": 5
                }
              },
              "required": [
                "param"
              ],
              "additionalProperties": false
            },
            "default": [],
            "description": "Debuffs to add to the target"
          },
          "scope": {
            "type": "integer",
            "minimum": 0,
            "maximum": 11,
            "description": "Target scope: 1 one enemy, 2 all enemies, 3-6 random enemies (1-4), 7 one ally, 8 all allies, 9 one dead ally, 10 all dead allies, 11 the user"
          }
        },
        "required": [
          "name"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "create_state_skill",
      "description": "Create a skill that adds or removes states (poison, sleep, etc.) on the target, each with its own success chance. State ids come from the States database (list_records type=states).",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string",
            "default": "",
            "description": "Two-line description shown in menus"
          },
          "mpCost": {
            "type": "integer",
            "minimum": 0,
            "default": 0
          },
          "tpCost": {
            "type": "integer",
            "minimum": 0,
            "default": 0
          },
          "iconIndex": {
            "type": "integer",
            "minimum": 0,
            "default": 0,
            "description": "Icon sheet index"
          },
          "animationId": {
            "type": "integer",
            "minimum": -1,
            "default": 0,
            "description": "Animation id from the Animations database (0 = none, -1 = normal attack)"
          },
          "stypeId": {
            "type": "integer",
            "minimum": 0,
            "default": 1,
            "description": "Skill type id (1 = Magic by default)"
          },
          "occasion": {
            "type": "integer",
            "minimum": 0,
            "maximum": 3,
            "description": "When usable: 0 always, 1 battle only, 2 menu only, 3 never"
          },
          "note": {
            "type": "string",
            "default": ""
          },
          "action": {
            "type": "string",
            "enum": [
              "add",
              "remove"
            ],
            "default": "add"
          },
          "states": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "stateId": {
                  "type": "integer",
                  "minimum": 1
                },
                "chance": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 100,
                  "default": 100,
                  "description": "Success chance in %"
                }
              },
              "required": [
                "stateId"
              ],
              "additionalProperties": false
            },
            "minItems": 1,
            "description": "States to add/remove"
          },
          "scope": {
            "type": "integer",
            "minimum": 0,
            "maximum": 11,
            "description": "Target scope: 1 one enemy, 2 all enemies, 3-6 random enemies (1-4), 7 one ally, 8 all allies, 9 one dead ally, 10 all dead allies, 11 the user (default: one enemy for add, one ally for remove)"
          }
        },
        "required": [
          "name",
          "states"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "search_records",
      "description": "Case-insensitive substring search across database records (name, nickname, description, note, profile, messages). Searches one type, or all types when type is omitted. Returns {type, id, name, matchedIn} summaries.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "minLength": 1
          },
          "type": {
            "type": "string",
            "enum": [
              "actors",
              "classes",
              "skills",
              "items",
              "weapons",
              "armors",
              "enemies",
              "troops",
              "states",
              "animations",
              "tilesets",
              "commonEvents"
            ],
            "description": "Database to search; omit to search all databases"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 200,
            "default": 50
          }
        },
        "required": [
          "query"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "search_map_events",
      "description": "Case-insensitive substring search across events on one map or every map. Matches event names and notes; with searchCommands=true it also searches inside event command parameters (message text, script lines, plugin commands). Returns {mapId, mapName, eventId, name, x, y, matchedIn}.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "minLength": 1
          },
          "mapId": {
            "type": "integer",
            "minimum": 1,
            "description": "Search only this map; omit for all maps"
          },
          "searchCommands": {
            "type": "boolean",
            "default": false,
            "description": "Also search inside event command lists (slower, finds text/script content)"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 200,
            "default": 50
          }
        },
        "required": [
          "query"
        ],
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "list_backups",
      "description": "List automatic backup sessions in <project>/.mcp-backups. A file is snapshotted there the first time each server session modifies it, so every session can be rolled back with restore_backup.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "restore_backup",
      "description": "Restore project files from a backup session (see list_backups). Restores one file (project-relative path like 'data/Actors.json') or, with no file given, every file in the session. The current state is itself backed up first, so a restore can be undone.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "session": {
            "type": "string",
            "description": "Backup session name from list_backups; defaults to the most recent"
          },
          "file": {
            "type": "string",
            "description": "Project-relative file to restore; omit to restore all files in the session"
          }
        },
        "additionalProperties": false,
        "$schema": "http://json-schema.org/draft-07/schema#"
      }
    },
    {
      "name": "validate_project",
      "description": "Integrity check of the whole project: parses every database file, verifies MapInfos entries have map files (and finds orphaned map files), checks registered plugins have source files, and scans event commands for references to missing common events or transfer destinations. Returns errors (broken) and warnings (suspicious).",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    }
  ]
}
