/**
 * GENERATED FILE — do not edit by hand.
 * Machine-generated from tools/list of rpgmaker-mz-mcp@1.3.0.
 * Regenerate with: bun run scripts/generate-mz-manifest.ts
 */
export const MZ_MANIFEST = {
  "package": "rpgmaker-mz-mcp",
  "version": "1.3.0",
  "tools": [
    {
      "name": "get_project",
      "description": "Get the project directory the server is currently operating on: its path, whether it is a valid RPG Maker MZ project, and the game title it holds.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "set_project",
      "description": "Point the server at a different RPG Maker MZ project directory for the rest of the session (overrides RPGMAKER_PROJECT_PATH until the server restarts). The directory must contain game.rmmzproject and data/System.json.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "path": {
            "type": "string"
          }
        },
        "required": [
          "path"
        ]
      }
    },
    {
      "name": "update_actor",
      "description": "Update an actor's properties",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "actorId": {
            "type": "number"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "actorId",
          "updates"
        ]
      }
    },
    {
      "name": "create_actor",
      "description": "Create a new actor in data/Actors.json. Only `name` is required; omitted fields use the editor's new-actor defaults (class 1, level 1-99, five empty equip slots, no traits). Allocates and returns the next unused actor id. NOTE: an actor's physical accuracy comes from its class + own traits — a class/actor with no Hit Rate trait (xparam id 0: trait { code: 22, dataId: 0, value: 0.95 }) always misses physical actions. The built-in class 1 has one; a custom class needs it added.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "nickname": {
            "type": "string"
          },
          "profile": {
            "type": "string"
          },
          "classId": {
            "type": "number"
          },
          "initialLevel": {
            "type": "number"
          },
          "maxLevel": {
            "type": "number"
          },
          "characterName": {
            "type": "string"
          },
          "characterIndex": {
            "type": "number"
          },
          "faceName": {
            "type": "string"
          },
          "faceIndex": {
            "type": "number"
          },
          "battlerName": {
            "type": "string"
          },
          "traits": {
            "type": "array",
            "items": {}
          },
          "equips": {
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "note": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name"
        ]
      }
    },
    {
      "name": "search_actors",
      "description": "Search actors by name or nickname",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "searchTerm": {
            "type": "string"
          }
        },
        "required": [
          "searchTerm"
        ]
      }
    },
    {
      "name": "create_item",
      "description": "Create a new item in data/Items.json. Only `name` is worth passing; omitted fields use the editor's new-item defaults (Regular Item, consumable, no effects). Allocates and returns the next unused item id. An effect referencing a missing record throws: Add/Remove State (code 21/22) → state, Learn Skill (43) → skill, Common Event (44) → common event.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "iconIndex": {
            "type": "number"
          },
          "itypeId": {
            "type": "number"
          },
          "scope": {
            "type": "number"
          },
          "occasion": {
            "type": "number"
          },
          "price": {
            "type": "number"
          },
          "consumable": {
            "type": "boolean"
          },
          "successRate": {
            "type": "number"
          },
          "repeats": {
            "type": "number"
          },
          "tpGain": {
            "type": "number"
          },
          "hitType": {
            "type": "number"
          },
          "animationId": {
            "type": "number"
          },
          "damage": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "effects": {
            "type": "array",
            "items": {}
          },
          "note": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name"
        ]
      }
    },
    {
      "name": "update_item",
      "description": "Update an item's properties (shallow merge into the existing record)",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "itemId": {
            "type": "number"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "itemId",
          "updates"
        ]
      }
    },
    {
      "name": "search_items",
      "description": "Search items by name or description",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "searchTerm": {
            "type": "string"
          }
        },
        "required": [
          "searchTerm"
        ]
      }
    },
    {
      "name": "create_weapon",
      "description": "Create a new weapon in data/Weapons.json. Only `name` is required; omitted fields use the editor's new-weapon defaults (Weapon equip slot, no stat bonuses). `params` is a flat 8-length stat bonus [maxHP, maxMP, atk, def, mat, mdf, agi, luk]. Allocates and returns the next unused weapon id.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "iconIndex": {
            "type": "number"
          },
          "wtypeId": {
            "type": "number"
          },
          "price": {
            "type": "number"
          },
          "params": {
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "animationId": {
            "type": "number"
          },
          "traits": {
            "type": "array",
            "items": {}
          },
          "note": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name"
        ]
      }
    },
    {
      "name": "update_weapon",
      "description": "Update a weapon's properties (shallow merge into the existing record)",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "weaponId": {
            "type": "number"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "weaponId",
          "updates"
        ]
      }
    },
    {
      "name": "create_armor",
      "description": "Create a new armor in data/Armors.json. Only `name` is required; omitted fields use the editor's new-armor defaults (Shield equip slot, no stat bonuses). `params` is a flat 8-length stat bonus; `etypeId` is the equip slot (System.json equipTypes: 2 Shield, 3 Head, 4 Body, 5 Accessory). Allocates and returns the next unused armor id.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "iconIndex": {
            "type": "number"
          },
          "atypeId": {
            "type": "number"
          },
          "etypeId": {
            "type": "number"
          },
          "price": {
            "type": "number"
          },
          "params": {
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "traits": {
            "type": "array",
            "items": {}
          },
          "note": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name"
        ]
      }
    },
    {
      "name": "update_armor",
      "description": "Update an armor's properties (shallow merge into the existing record)",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "armorId": {
            "type": "number"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "armorId",
          "updates"
        ]
      }
    },
    {
      "name": "create_skill",
      "description": "Create a new skill with custom properties. An effect referencing a missing record throws: Add/Remove State (code 21/22) → state, Learn Skill (43) → skill, Common Event (44) → common event.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "description": {
            "type": "string"
          },
          "iconIndex": {
            "type": "number"
          },
          "mpCost": {
            "type": "number"
          },
          "tpCost": {
            "type": "number"
          },
          "scope": {
            "type": "number"
          },
          "damage": {
            "type": "object",
            "properties": {
              "type": {
                "type": "number"
              },
              "elementId": {
                "type": "number"
              },
              "formula": {
                "type": "string"
              },
              "variance": {
                "type": "number"
              },
              "critical": {
                "type": "boolean"
              }
            }
          },
          "effects": {
            "type": "array",
            "items": {}
          },
          "animationId": {
            "type": "number"
          },
          "message1": {
            "type": "string"
          },
          "stypeId": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name"
        ]
      }
    },
    {
      "name": "create_damage_skill",
      "description": "Create a damage-dealing skill (simplified)",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "damageFormula": {
            "type": "string"
          },
          "mpCost": {
            "type": "number"
          },
          "scope": {
            "type": "number"
          },
          "elementId": {
            "type": "number"
          },
          "description": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name",
          "damageFormula",
          "mpCost",
          "scope"
        ]
      }
    },
    {
      "name": "create_healing_skill",
      "description": "Create a healing skill (simplified)",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "healFormula": {
            "type": "string"
          },
          "mpCost": {
            "type": "number"
          },
          "scope": {
            "type": "number"
          },
          "description": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name",
          "healFormula",
          "mpCost",
          "scope"
        ]
      }
    },
    {
      "name": "create_buff_skill",
      "description": "Create a buff skill (simplified)",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "buffType": {
            "type": "number"
          },
          "turns": {
            "type": "number"
          },
          "mpCost": {
            "type": "number"
          },
          "scope": {
            "type": "number"
          },
          "description": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name",
          "buffType",
          "turns",
          "mpCost",
          "scope"
        ]
      }
    },
    {
      "name": "create_state_skill",
      "description": "Create a state-inflicting skill (poison, sleep, etc.). Throws if `stateId` does not exist in States.json (create the state first with create_state).",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "stateId": {
            "type": "number"
          },
          "chance": {
            "type": "number"
          },
          "mpCost": {
            "type": "number"
          },
          "scope": {
            "type": "number"
          },
          "description": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name",
          "stateId",
          "chance",
          "mpCost",
          "scope"
        ]
      }
    },
    {
      "name": "update_skill",
      "description": "Update a skill's properties",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "skillId": {
            "type": "number"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "skillId",
          "updates"
        ]
      }
    },
    {
      "name": "search_skills",
      "description": "Search skills by name or description",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "searchTerm": {
            "type": "string"
          }
        },
        "required": [
          "searchTerm"
        ]
      }
    },
    {
      "name": "get_map",
      "description": "Get map data by ID. The tile `data` array can be huge on a painted map (width*height*6 ints) and blow the MCP token limit, so pass includeData:false to omit it (you get dataTileCount instead) and read tiles with get_map_region when needed. includeData defaults to true for backward compatibility.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "includeData": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId"
        ]
      }
    },
    {
      "name": "get_map_region",
      "description": "Read the raw tile ids in a rectangular window of one map layer — a token-cheap alternative to get_map for inspecting part of a painted map. Returns `tiles` as a 2D array (rows top→bottom, each left→right) of raw engine tile ids. The rectangle must lie fully within the map bounds (throws otherwise). layer defaults to 0 (see set_map_tile for the z-layer meanings).",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "width": {
            "type": "number"
          },
          "height": {
            "type": "number"
          },
          "layer": {
            "type": "number"
          }
        },
        "required": [
          "mapId",
          "x",
          "y",
          "width",
          "height"
        ]
      }
    },
    {
      "name": "get_map_infos",
      "description": "Get information about all maps",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "create_map",
      "description": "Create a new blank map: writes a new data/MapNNN.json (all tiles unpainted) and registers it in the map tree (MapInfos.json). Allocates the next unused map id and returns it. Paint tiles afterward with paint_tiles/fill_area (autotile-aware) and add events with create_map_event/create_npc.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "width": {
            "type": "number"
          },
          "height": {
            "type": "number"
          },
          "parentId": {
            "type": "number"
          },
          "tilesetId": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name"
        ]
      }
    },
    {
      "name": "delete_map",
      "description": "Delete a map: remove its entry from the map tree (MapInfos.json) and delete its data/MapNNN.json file. The deleted map's direct children are reparented onto its parent (not deleted), so removing one node doesn't wipe a whole sub-tree. Does not touch System.json.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId"
        ]
      }
    },
    {
      "name": "update_map_tree",
      "description": "Edit the map tree (MapInfos.json) only — reparent, reorder, rename, or expand/collapse maps without touching their tiles or events. Takes a batch of per-map updates; every referenced map (and any non-zero parentId) must exist, and the resulting tree must stay acyclic.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "updates": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "mapId": {
                  "type": "number"
                },
                "parentId": {
                  "type": "number"
                },
                "order": {
                  "type": "number"
                },
                "name": {
                  "type": "string"
                },
                "expanded": {
                  "type": "boolean"
                }
              },
              "required": [
                "mapId"
              ]
            }
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "updates"
        ]
      }
    },
    {
      "name": "get_map_events",
      "description": "Get all events from a specific map",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          }
        },
        "required": [
          "mapId"
        ]
      }
    },
    {
      "name": "get_map_event",
      "description": "Get a specific event from a map",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "eventId": {
            "type": "number"
          }
        },
        "required": [
          "mapId",
          "eventId"
        ]
      }
    },
    {
      "name": "update_map_event",
      "description": "Update a map event's properties. Refuses the write (nothing is saved) if the resulting event is structurally invalid — pass force: true to override.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "eventId": {
            "type": "number"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          },
          "verbose": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "eventId",
          "updates"
        ]
      }
    },
    {
      "name": "create_map_event",
      "description": "Create a new event on a map. Each page is merged onto a blank \"New Event\" page (trigger 0 action-button, priority 0 below characters, no graphic, empty command list, standing move type), so you only supply the fields that differ — pass e.g. `{ image: { characterName: 'Actor1', characterIndex: 0 }, trigger: 3, list: [...] }` and the rest is filled in. Nested `image`/`conditions` deep-merge; an omitted `list` becomes a valid empty (code-0-terminated) list. Omit `pages` entirely for a bare one-page event. For the common \"talking NPC\" case prefer create_npc. An action-button page meant to fire from facing (doors, entrances, signs) needs `priorityType: 1` — with the default 0 (below) it only fires when stood on, so on an impassable tile it can never trigger (this is refused, not written; pass force: true to override). A structurally invalid command list is refused the same way. Page fields: `image` { characterName, characterIndex, direction (2 down/4 left/6 right/8 up), pattern, tileId }, `trigger` (0 action-button/1 player-touch/2 event-touch/3 autorun/4 parallel), `priorityType` (0 below/1 same/2 above), `moveType` (0 fixed/1 random/2 approach/3 custom), `conditions`, `list`.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "name": {
            "type": "string"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "note": {
            "type": "string"
          },
          "pages": {
            "type": "array",
            "items": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            }
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "name",
          "x",
          "y"
        ]
      }
    },
    {
      "name": "search_map_events",
      "description": "Search events on a map by name",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "searchTerm": {
            "type": "string"
          }
        },
        "required": [
          "mapId",
          "searchTerm"
        ]
      }
    },
    {
      "name": "add_event_command",
      "description": "Add a command to an event page. Refuses the write (nothing is saved) if the resulting page is structurally invalid — e.g. the command has the wrong parameter count for its code. Pass force: true to override.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "eventId": {
            "type": "number"
          },
          "pageIndex": {
            "type": "number"
          },
          "command": {
            "type": "object",
            "properties": {
              "code": {
                "type": "number"
              },
              "indent": {
                "default": 0,
                "type": "number"
              },
              "parameters": {
                "type": "array",
                "items": {}
              }
            },
            "required": [
              "code",
              "parameters"
            ]
          },
          "position": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          },
          "verbose": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "eventId",
          "pageIndex",
          "command"
        ]
      }
    },
    {
      "name": "update_map",
      "description": "Update a map's top-level properties (name, display name, bgm, encounters, etc.). Does not repaint tiles. Cannot change width/height (that would desync the tile data array) — use resize_map for that. The echo omits the tile `data` array and the `events` map (neither is touched here) and reports dataTileCount/eventCount instead; pass verbose: true or use get_map for the full record.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "dryRun": {
            "type": "boolean"
          },
          "verbose": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "updates"
        ]
      }
    },
    {
      "name": "resize_map",
      "description": "Resize a map to new width/height, safely repadding every z-layer of its tile data (existing tiles kept where the old and new grids overlap; new cells blank; shrinking crops). This is the ONLY safe way to change a map's dimensions — update_map refuses a width/height change because it would not resize the tile array. Warns about any event left outside the new bounds.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "width": {
            "type": "number"
          },
          "height": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          },
          "verbose": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "width",
          "height"
        ]
      }
    },
    {
      "name": "set_encounters",
      "description": "Set a map's random-encounter list (replaces it wholesale) and optionally its encounterStep (average steps between encounters). Each encounter is { troopId, weight?, regionSet? }: weight biases the random pick (default 5), regionSet restricts it to those map region ids (empty/omitted = anywhere). Every troopId is validated against Troops.json — a non-existent troop throws. Prefer this over update_map for encounters (it validates and hides the on-disk shape).",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "encounters": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "troopId": {
                  "type": "number"
                },
                "weight": {
                  "type": "number"
                },
                "regionSet": {
                  "type": "array",
                  "items": {
                    "type": "number"
                  }
                }
              },
              "required": [
                "troopId"
              ]
            }
          },
          "encounterStep": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "encounters"
        ]
      }
    },
    {
      "name": "get_map_dimensions",
      "description": "Get the width and height (in tiles) of a map",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          }
        },
        "required": [
          "mapId"
        ]
      }
    },
    {
      "name": "set_map_tile",
      "description": "Set a single raw tile ID at (x, y) on a given z-layer (0-5). Note: tile IDs are raw engine integers; this is a low-level primitive without autotile/passability awareness.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "layer": {
            "type": "number"
          },
          "tileId": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "x",
          "y",
          "layer",
          "tileId"
        ]
      }
    },
    {
      "name": "delete_map_event",
      "description": "Delete an event from a map by ID",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "eventId": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "eventId"
        ]
      }
    },
    {
      "name": "create_enemy",
      "description": "Create a new enemy in data/Enemies.json. Only `name` is required; omitted fields use the editor's new-enemy defaults (100 HP, one Attack action, no drops). Allocates the next unused enemy id and returns `{ enemy, warnings? }` (warn-by-default: a `battlerName` not found in img/enemies is flagged, never blocked). Throws if an `actions[].skillId` or a `dropItems[].dataId` (item/weapon/armor by `kind`) references a record that does not exist. NOTE: an enemy with no Hit Rate trait (xparam id 0: trait { code: 22, dataId: 0, value: 0.95 }) always misses physical actions — pass one in `traits` if the enemy should land basic attacks.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "battlerName": {
            "type": "string"
          },
          "battlerHue": {
            "type": "number"
          },
          "params": {
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "exp": {
            "type": "number"
          },
          "gold": {
            "type": "number"
          },
          "note": {
            "type": "string"
          },
          "traits": {
            "type": "array",
            "items": {}
          },
          "dropItems": {
            "type": "array",
            "items": {}
          },
          "actions": {
            "type": "array",
            "items": {}
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name"
        ]
      }
    },
    {
      "name": "update_enemy",
      "description": "Update an enemy's properties (shallow merge into the existing record). Returns `{ enemy, warnings? }` — a `battlerName` not found in img/enemies is flagged warn-by-default.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "enemyId": {
            "type": "number"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "enemyId",
          "updates"
        ]
      }
    },
    {
      "name": "search_enemies",
      "description": "Search enemies by name (case-insensitive)",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "searchTerm": {
            "type": "string"
          }
        },
        "required": [
          "searchTerm"
        ]
      }
    },
    {
      "name": "create_troop",
      "description": "Create a new troop (enemy battle group) in data/Troops.json. `name` is required; `members` defaults to empty and `pages` to one blank battle-event page. Every member.enemyId must reference an existing enemy. A structurally invalid battle-event page refuses the write (nothing is saved) — pass force: true to override.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "members": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "enemyId": {
                  "type": "number"
                },
                "x": {
                  "type": "number"
                },
                "y": {
                  "type": "number"
                },
                "hidden": {
                  "default": false,
                  "type": "boolean"
                }
              },
              "required": [
                "enemyId",
                "x",
                "y"
              ]
            }
          },
          "pages": {
            "type": "array",
            "items": {}
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          },
          "verbose": {
            "type": "boolean"
          }
        },
        "required": [
          "name"
        ]
      }
    },
    {
      "name": "update_troop",
      "description": "Update a troop's properties (shallow merge). If `members` is provided, each enemyId is validated to exist. A structurally invalid battle-event page refuses the write (nothing is saved) — pass force: true to override.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "troopId": {
            "type": "number"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          },
          "verbose": {
            "type": "boolean"
          }
        },
        "required": [
          "troopId",
          "updates"
        ]
      }
    },
    {
      "name": "search_troops",
      "description": "Search troops by name (case-insensitive)",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "searchTerm": {
            "type": "string"
          }
        },
        "required": [
          "searchTerm"
        ]
      }
    },
    {
      "name": "create_class",
      "description": "Create a new character class in data/Classes.json. Only `name` is required; omitted fields use the editor's new-class defaults (EXP curve [30,20,30,30], no traits/learnings, a linear param curve to maxLevel). Allocates and returns the next unused class id. NOTE: a class with no Hit Rate trait (xparam id 0: trait { code: 22, dataId: 0, value: 0.95 }) makes its actors always miss physical actions — pass one in `traits` for a combat-ready class. Likewise every learned skill's stypeId needs an Add Skill Type trait ({ code: 41, dataId: stypeId, value: 1 }) or the skill-type command never appears (warned, never blocked).",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "maxLevel": {
            "type": "number"
          },
          "expParams": {
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "params": {
            "type": "array",
            "items": {
              "type": "array",
              "items": {
                "type": "number"
              }
            }
          },
          "learnings": {
            "type": "array",
            "items": {}
          },
          "traits": {
            "type": "array",
            "items": {}
          },
          "note": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name"
        ]
      }
    },
    {
      "name": "update_class",
      "description": "Update a class's properties (shallow merge into the existing record). Use for name, expParams, traits, or to replace the whole learnings/params arrays; for targeted edits prefer add_class_learning / set_class_param_curve. Warns when a learned skill's stypeId has no Add Skill Type trait ({ code: 41 }).",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "classId": {
            "type": "number"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "classId",
          "updates"
        ]
      }
    },
    {
      "name": "add_class_learning",
      "description": "Add a \"learn skill at level\" entry to a class (replaces the hack of attaching skills to an actor via an Add-Skill trait). Validates the skillId exists and keeps the learnings sorted by level. Warns (never blocks) when the skill's stypeId is not covered by an Add Skill Type trait ({ code: 41, dataId: stypeId, value: 1 }) on the class — without it the skill-type command never appears and actors cannot use the skill.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "classId": {
            "type": "number"
          },
          "skillId": {
            "type": "number"
          },
          "level": {
            "type": "number"
          },
          "note": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "classId",
          "skillId",
          "level"
        ]
      }
    },
    {
      "name": "set_class_param_curve",
      "description": "Replace one of a class's 8 parameter growth curves. paramId is 0-7 ([maxHP,maxMP,atk,def,mat,mdf,agi,luk]); values must match the existing curve length (same max level).",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "classId": {
            "type": "number"
          },
          "paramId": {
            "type": "number"
          },
          "values": {
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "classId",
          "paramId",
          "values"
        ]
      }
    },
    {
      "name": "create_state",
      "description": "Create a new state (status condition like Poison/Sleep) in data/States.json. Only `name` is required; omitted fields use the editor's new-state defaults (no restriction, priority 50, no auto-removal, 1-turn duration). Allocates and returns the next unused state id.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "restriction": {
            "type": "number"
          },
          "priority": {
            "type": "number"
          },
          "motion": {
            "type": "number"
          },
          "overlay": {
            "type": "number"
          },
          "removeAtBattleEnd": {
            "type": "boolean"
          },
          "removeByRestriction": {
            "type": "boolean"
          },
          "autoRemovalTiming": {
            "type": "number"
          },
          "minTurns": {
            "type": "number"
          },
          "maxTurns": {
            "type": "number"
          },
          "removeByDamage": {
            "type": "boolean"
          },
          "chanceByDamage": {
            "type": "number"
          },
          "removeByWalking": {
            "type": "boolean"
          },
          "stepsToRemove": {
            "type": "number"
          },
          "releaseByDamage": {
            "type": "boolean"
          },
          "iconIndex": {
            "type": "number"
          },
          "message1": {
            "type": "string"
          },
          "message2": {
            "type": "string"
          },
          "message3": {
            "type": "string"
          },
          "message4": {
            "type": "string"
          },
          "messageType": {
            "type": "number"
          },
          "traits": {
            "type": "array",
            "items": {}
          },
          "note": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "name"
        ]
      }
    },
    {
      "name": "update_state",
      "description": "Update a state's properties (shallow merge into the existing record)",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "stateId": {
            "type": "number"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "stateId",
          "updates"
        ]
      }
    },
    {
      "name": "create_common_event",
      "description": "Create a new common event (reusable event-command list) in data/CommonEvents.json. Only `name` is required; omitted fields use the editor's new-slot defaults (empty command list, trigger 0 = call-only, switchId 1). Allocates and returns the next unused id. A structurally invalid command list refuses the write (nothing is saved) — pass force: true to override.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "name": {
            "type": "string"
          },
          "trigger": {
            "type": "number"
          },
          "switchId": {
            "type": "number"
          },
          "list": {
            "type": "array",
            "items": {}
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          },
          "verbose": {
            "type": "boolean"
          }
        },
        "required": [
          "name"
        ]
      }
    },
    {
      "name": "update_common_event",
      "description": "Update a common event's properties (shallow merge into the existing record). Use for name, trigger, switchId, or to replace the whole command list. A structurally invalid command list refuses the write (nothing is saved) — pass force: true to override.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "commonEventId": {
            "type": "number"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          },
          "verbose": {
            "type": "boolean"
          }
        },
        "required": [
          "commonEventId",
          "updates"
        ]
      }
    },
    {
      "name": "call_common_event",
      "description": "Build a \"Common Event\" event command (code 117) that calls the given common event, for insertion into an event page via insert_event_commands. Validates the common event exists. Read-only: returns `{ command }` (matching the build_* tools, so it composes into a thenBranch/commands array); writes nothing.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "commonEventId": {
            "type": "number"
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "commonEventId"
        ]
      }
    },
    {
      "name": "create_move_route",
      "description": "Build a movement route from a named pattern (patrol/approach/flee/wander/custom) instead of raw move-command codes. Read-only: returns { moveRoute, warnings? }. Use the route as an event page’s autonomous moveRoute (update_map_event with moveType 3), or feed it to set_movement_route for a forced route in an event command list.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "pattern": {
            "type": "string",
            "enum": [
              "patrol",
              "approach",
              "flee",
              "wander",
              "custom"
            ]
          },
          "direction": {
            "type": "string",
            "enum": [
              "up",
              "down",
              "left",
              "right"
            ]
          },
          "steps": {
            "type": "number"
          },
          "commands": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "number"
                },
                "parameters": {
                  "type": "array",
                  "items": {}
                }
              },
              "required": [
                "code"
              ]
            }
          },
          "repeat": {
            "type": "boolean"
          },
          "skippable": {
            "type": "boolean"
          },
          "wait": {
            "type": "boolean"
          }
        },
        "required": [
          "pattern"
        ]
      }
    },
    {
      "name": "set_movement_route",
      "description": "Insert a forced \"Set Movement Route\" (event command 205, plus the 505 continuation rows the editor expects) into an event page’s command list, moving a character as part of that page. characterId: -1 player, 0 this event, N event id. Pass a moveRoute from create_move_route. A structurally invalid route or page refuses the write (nothing is saved) — pass force: true to override.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "eventId": {
            "type": "number"
          },
          "pageIndex": {
            "type": "number"
          },
          "characterId": {
            "type": "number"
          },
          "moveRoute": {
            "type": "object",
            "properties": {
              "list": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "code": {
                      "type": "number"
                    },
                    "parameters": {
                      "type": "array",
                      "items": {}
                    }
                  },
                  "required": [
                    "code"
                  ]
                }
              },
              "repeat": {
                "type": "boolean"
              },
              "skippable": {
                "type": "boolean"
              },
              "wait": {
                "type": "boolean"
              }
            },
            "required": [
              "list"
            ]
          },
          "indent": {
            "type": "number"
          },
          "position": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "eventId",
          "pageIndex",
          "characterId",
          "moveRoute"
        ]
      }
    },
    {
      "name": "build_show_text",
      "description": "Build a Show Text event-command sequence (101 setup + one 401 line per text line) for insertion via insert_event_commands. Supports face image (from list_assets(\"faces\")), window background/position, and the MZ name-box speaker. MZ does NOT word-wrap: keep each line under ~55 chars (~38 with a face) or it is cut off at the window edge (warned, never blocked). Read-only: returns { commands, warnings? }, writes nothing.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "lines": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "faceName": {
            "type": "string"
          },
          "faceIndex": {
            "type": "number"
          },
          "background": {
            "type": "string",
            "enum": [
              "window",
              "dim",
              "transparent"
            ]
          },
          "position": {
            "type": "string",
            "enum": [
              "top",
              "middle",
              "bottom"
            ]
          },
          "speakerName": {
            "type": "string"
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "lines"
        ]
      }
    },
    {
      "name": "build_show_choices",
      "description": "Build a Show Choices block (102 opener + a 402 branch per choice + optional 403 When-Cancel branch + 404 closer, each branch terminated like the editor) for insertion via insert_event_commands. Pass per-choice `branches` (each an EventCommand[] — e.g. from build_show_text) to fill the branch bodies. Read-only: returns { commands }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "choices": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "branches": {
            "type": "array",
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "code": {
                    "type": "number"
                  },
                  "indent": {
                    "type": "number"
                  },
                  "parameters": {
                    "type": "array",
                    "items": {}
                  }
                },
                "required": [
                  "code"
                ]
              }
            }
          },
          "cancelBranch": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "number"
                },
                "indent": {
                  "type": "number"
                },
                "parameters": {
                  "type": "array",
                  "items": {}
                }
              },
              "required": [
                "code"
              ]
            }
          },
          "cancelType": {
            "type": "number"
          },
          "defaultType": {
            "type": "number"
          },
          "position": {
            "type": "string",
            "enum": [
              "left",
              "middle",
              "right"
            ]
          },
          "background": {
            "type": "string",
            "enum": [
              "window",
              "dim",
              "transparent"
            ]
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "choices"
        ]
      }
    },
    {
      "name": "build_conditional_branch",
      "description": "Build a Conditional Branch block (111 condition + then-branch + optional 411 Else + 412 closer, each branch terminated like the editor) for insertion via insert_event_commands. Condition types: switch, self_switch, variable, actor_in_party, gold, item. Provide thenBranch/elseBranch as EventCommand[] (e.g. from other builders). Read-only: returns { commands }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "condition": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "switch",
                  "self_switch",
                  "variable",
                  "actor_in_party",
                  "gold",
                  "item"
                ]
              },
              "switchId": {
                "type": "number"
              },
              "name": {
                "type": "string",
                "enum": [
                  "A",
                  "B",
                  "C",
                  "D"
                ]
              },
              "value": {
                "type": "string",
                "enum": [
                  "on",
                  "off"
                ]
              },
              "variableId": {
                "type": "number"
              },
              "comparison": {
                "type": "string",
                "enum": [
                  "==",
                  ">=",
                  "<=",
                  ">",
                  "<",
                  "!="
                ]
              },
              "constant": {
                "type": "number"
              },
              "variableOperand": {
                "type": "number"
              },
              "actorId": {
                "type": "number"
              },
              "itemId": {
                "type": "number"
              },
              "gold": {
                "type": "number"
              },
              "compare": {
                "type": "string",
                "enum": [
                  ">=",
                  "<=",
                  "<"
                ]
              }
            },
            "required": [
              "type"
            ]
          },
          "thenBranch": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "number"
                },
                "indent": {
                  "type": "number"
                },
                "parameters": {
                  "type": "array",
                  "items": {}
                }
              },
              "required": [
                "code"
              ]
            }
          },
          "elseBranch": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "number"
                },
                "indent": {
                  "type": "number"
                },
                "parameters": {
                  "type": "array",
                  "items": {}
                }
              },
              "required": [
                "code"
              ]
            }
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "condition"
        ]
      }
    },
    {
      "name": "build_flow_command",
      "description": "Build a single flow-control event command for insertion via insert_event_commands: wait (230, N frames), exit_event (115), label (118, a named jump target), or jump_to_label (119). Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "wait",
              "exit_event",
              "label",
              "jump_to_label"
            ]
          },
          "frames": {
            "type": "number"
          },
          "name": {
            "type": "string"
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "kind"
        ]
      }
    },
    {
      "name": "build_control_switch",
      "description": "Build a Control Switches (121) or Control Self Switch (123) event command for insertion via insert_event_commands. scope \"switch\": set a switch (or the inclusive switchId..endId range) on/off. scope \"self_switch\": set the current event's self switch A–D. Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "scope": {
            "type": "string",
            "enum": [
              "switch",
              "self_switch"
            ]
          },
          "switchId": {
            "type": "number"
          },
          "endId": {
            "type": "number"
          },
          "name": {
            "type": "string",
            "enum": [
              "A",
              "B",
              "C",
              "D"
            ]
          },
          "value": {
            "type": "string",
            "enum": [
              "on",
              "off"
            ]
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "scope"
        ]
      }
    },
    {
      "name": "build_control_variable",
      "description": "Build a Control Variables (122) event command for insertion via insert_event_commands. Applies operation (set/add/sub/mul/div/mod) to a variable (or the inclusive variableId..endId range) using an operand: constant, another variable, a random range, or game_data (item/actor/party/… readouts). Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "variableId": {
            "type": "number"
          },
          "endId": {
            "type": "number"
          },
          "operation": {
            "type": "string",
            "enum": [
              "set",
              "add",
              "sub",
              "mul",
              "div",
              "mod"
            ]
          },
          "operand": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "constant",
                  "variable",
                  "random",
                  "game_data"
                ]
              },
              "value": {
                "type": "number"
              },
              "variableId": {
                "type": "number"
              },
              "min": {
                "type": "number"
              },
              "max": {
                "type": "number"
              },
              "dataType": {
                "type": "number"
              },
              "param1": {
                "type": "number"
              },
              "param2": {
                "type": "number"
              }
            },
            "required": [
              "type"
            ]
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "variableId",
          "operand"
        ]
      }
    },
    {
      "name": "build_change_gold",
      "description": "Build a Change Gold (125) event command for insertion via insert_event_commands — increase or decrease party gold by a constant or variable amount. Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "operation": {
            "type": "string",
            "enum": [
              "increase",
              "decrease"
            ]
          },
          "operand": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "constant",
                  "variable"
                ]
              },
              "value": {
                "type": "number"
              },
              "variableId": {
                "type": "number"
              }
            },
            "required": [
              "type"
            ]
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "operation",
          "operand"
        ]
      }
    },
    {
      "name": "build_change_items",
      "description": "Build a Change Items (126), Change Weapons (127), or Change Armors (128) event command for insertion via insert_event_commands — gain/lose an item/weapon/armor by a constant or variable amount. includeEquip (weapon/armor only) also counts equipped copies when removing. Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "item",
              "weapon",
              "armor"
            ]
          },
          "id": {
            "type": "number"
          },
          "operation": {
            "type": "string",
            "enum": [
              "increase",
              "decrease"
            ]
          },
          "operand": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "constant",
                  "variable"
                ]
              },
              "value": {
                "type": "number"
              },
              "variableId": {
                "type": "number"
              }
            },
            "required": [
              "type"
            ]
          },
          "includeEquip": {
            "type": "boolean"
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "kind",
          "id",
          "operation",
          "operand"
        ]
      }
    },
    {
      "name": "build_change_party_member",
      "description": "Build a Change Party Member (129) event command for insertion via insert_event_commands — add or remove an actor from the party. initialize (add only) resets the actor to their initial state. Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "actorId": {
            "type": "number"
          },
          "operation": {
            "type": "string",
            "enum": [
              "add",
              "remove"
            ]
          },
          "initialize": {
            "type": "boolean"
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "actorId",
          "operation"
        ]
      }
    },
    {
      "name": "build_transfer_player",
      "description": "Build a Transfer Player (201) event command for insertion via insert_event_commands — move the party to (x, y) on a map. With designation \"variable\", mapId/x/y are variable ids resolved at runtime. Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "direction": {
            "type": "string",
            "enum": [
              "retain",
              "down",
              "left",
              "right",
              "up"
            ]
          },
          "fade": {
            "type": "string",
            "enum": [
              "black",
              "white",
              "none"
            ]
          },
          "designation": {
            "type": "string",
            "enum": [
              "direct",
              "variable"
            ]
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "mapId",
          "x",
          "y"
        ]
      }
    },
    {
      "name": "build_play_audio",
      "description": "Build a Play BGM/BGS/ME/SE (241/245/249/250) event command for insertion via insert_event_commands. Warns (never blocks) when `name` is not a known audio asset for that channel (checked against list_assets). Returns { command, warnings? }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "bgm",
              "bgs",
              "me",
              "se"
            ]
          },
          "name": {
            "type": "string"
          },
          "volume": {
            "type": "number"
          },
          "pitch": {
            "type": "number"
          },
          "pan": {
            "type": "number"
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "kind",
          "name"
        ]
      }
    },
    {
      "name": "build_screen_effect",
      "description": "Build a screen transition/effect event command for insertion via insert_event_commands: fadeout (221) / fadein (222) — no params; tint (223) & flash (224) — an [r,g,b,a] color over `duration` frames; shake (225) — power/speed over `duration`. `wait` holds the event until it finishes. Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "fadeout",
              "fadein",
              "tint",
              "flash",
              "shake"
            ]
          },
          "color": {
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "power": {
            "type": "number"
          },
          "speed": {
            "type": "number"
          },
          "duration": {
            "type": "number"
          },
          "wait": {
            "type": "boolean"
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "kind"
        ]
      }
    },
    {
      "name": "build_picture",
      "description": "Build a Show Picture (231) or Erase Picture (235) event command for insertion via insert_event_commands. show: display `name` in slot `pictureId` with origin/position/scale/opacity/blend; erase: clear the slot. Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "show",
              "erase"
            ]
          },
          "pictureId": {
            "type": "number"
          },
          "name": {
            "type": "string"
          },
          "origin": {
            "type": "string",
            "enum": [
              "upper_left",
              "center"
            ]
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "scaleX": {
            "type": "number"
          },
          "scaleY": {
            "type": "number"
          },
          "opacity": {
            "type": "number"
          },
          "blend": {
            "type": "string",
            "enum": [
              "normal",
              "additive",
              "multiply",
              "screen"
            ]
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "kind",
          "pictureId"
        ]
      }
    },
    {
      "name": "build_character_effect",
      "description": "Build a Show Animation (212) or Show Balloon Icon (213) event command for insertion via insert_event_commands, played over a character (characterId: -1 player, 0 this event, N event id). Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "animation",
              "balloon"
            ]
          },
          "characterId": {
            "type": "number"
          },
          "id": {
            "type": "number"
          },
          "wait": {
            "type": "boolean"
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "kind",
          "characterId",
          "id"
        ]
      }
    },
    {
      "name": "build_battle_processing",
      "description": "Build a Battle Processing (301) event command for insertion via insert_event_commands — start a battle against a troop (direct id, a variable holding the id, or \"random\" like the map encounters). canEscape/canLose gate the battle result branches. Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "troop": {
            "type": "string",
            "enum": [
              "direct",
              "variable",
              "random"
            ]
          },
          "troopId": {
            "type": "number"
          },
          "canEscape": {
            "type": "boolean"
          },
          "canLose": {
            "type": "boolean"
          },
          "indent": {
            "type": "number"
          }
        }
      }
    },
    {
      "name": "build_shop_processing",
      "description": "Build a Shop Processing (302 + one 605 row per extra good) event-command sequence for insertion via insert_event_commands. Each good sells an item/weapon/armor at its database price, or a specified `price`. purchaseOnly hides the sell tab. Read-only: returns { commands }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "goods": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "item",
                    "weapon",
                    "armor"
                  ]
                },
                "id": {
                  "type": "number"
                },
                "price": {
                  "type": "number"
                }
              },
              "required": [
                "kind",
                "id"
              ]
            }
          },
          "purchaseOnly": {
            "type": "boolean"
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "goods"
        ]
      }
    },
    {
      "name": "build_name_input",
      "description": "Build a Name Input Processing (303) event command for insertion via insert_event_commands — open the name-entry screen for an actor. Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "actorId": {
            "type": "number"
          },
          "maxLength": {
            "type": "number"
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "actorId"
        ]
      }
    },
    {
      "name": "build_change_actor",
      "description": "Build an actor stat-change scene command for insertion via insert_event_commands: hp (311), mp (312), state (313), recover_all (314), exp (315), or level (316). Targets a fixed actor (0 = whole party) or a variable. hp/mp/exp/level take an increase/decrease `operand` (constant or variable); state takes add/remove + `stateId`; recover_all takes nothing extra. Read-only: returns { command }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "hp",
              "mp",
              "state",
              "recover_all",
              "exp",
              "level"
            ]
          },
          "target": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "fixed",
                  "variable"
                ]
              },
              "actorId": {
                "type": "number"
              },
              "variableId": {
                "type": "number"
              }
            },
            "required": [
              "type"
            ]
          },
          "operation": {
            "type": "string",
            "enum": [
              "increase",
              "decrease"
            ]
          },
          "operand": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "constant",
                  "variable"
                ]
              },
              "value": {
                "type": "number"
              },
              "variableId": {
                "type": "number"
              }
            },
            "required": [
              "type"
            ]
          },
          "allowKnockout": {
            "type": "boolean"
          },
          "showLevelUp": {
            "type": "boolean"
          },
          "stateOperation": {
            "type": "string",
            "enum": [
              "add",
              "remove"
            ]
          },
          "stateId": {
            "type": "number"
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "kind",
          "target"
        ]
      }
    },
    {
      "name": "insert_event_commands",
      "description": "Insert a pre-built sequence of event commands (from the build_* builders) into any of the three command lists an MZ project has — the mutating companion to the read-only builders. Splices before the list’s end marker (or at `position`). target \"map_event\" (the default) needs mapId + eventId + pageIndex; \"common_event\" needs commonEventId; \"troop_page\" needs troopId + pageIndex. The resulting list is validated before writing: a structural problem (wrong parameter count for a command code, a list left unterminated) refuses the write and saves nothing — pass force: true to override. Advisory findings (unrecognized code, over-long text line) are returned as `warnings` and never block. Returns { target, id, listLength, listCodes, warnings? } — the resulting list as its length and its command CODES, which is what you verify a splice against; pass verbose: true for the full list with parameters, or read it back with get_map_event.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "target": {
            "type": "string",
            "enum": [
              "map_event",
              "common_event",
              "troop_page"
            ]
          },
          "mapId": {
            "type": "number"
          },
          "eventId": {
            "type": "number"
          },
          "commonEventId": {
            "type": "number"
          },
          "troopId": {
            "type": "number"
          },
          "pageIndex": {
            "type": "number"
          },
          "commands": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "number"
                },
                "indent": {
                  "type": "number"
                },
                "parameters": {
                  "type": "array",
                  "items": {}
                }
              },
              "required": [
                "code"
              ]
            }
          },
          "position": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          },
          "verbose": {
            "type": "boolean"
          }
        },
        "required": [
          "commands"
        ]
      }
    },
    {
      "name": "set_event_page",
      "description": "Update an existing event page's graphic and behavior in one call, without rebuilding the whole page or touching its command list: sprite (characterName/characterIndex/direction/pattern or a tileId), trigger, priority, movement (type/speed/frequency/route), and the through/walkAnime/stepAnime/directionFix flags. Graphic fields merge onto the current image; warns (never blocks) on an unknown characterName. Refuses the write if the change would leave the event unreachable (an action-button page with priority `below` on an impassable tile) — pass force: true to override.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "eventId": {
            "type": "number"
          },
          "pageIndex": {
            "type": "number"
          },
          "characterName": {
            "type": "string"
          },
          "characterIndex": {
            "type": "number"
          },
          "direction": {
            "type": "string",
            "enum": [
              "down",
              "left",
              "right",
              "up"
            ]
          },
          "pattern": {
            "type": "number"
          },
          "tileId": {
            "type": "number"
          },
          "trigger": {
            "type": "string",
            "enum": [
              "action_button",
              "player_touch",
              "event_touch",
              "autorun",
              "parallel"
            ]
          },
          "priority": {
            "type": "string",
            "enum": [
              "below",
              "same",
              "above"
            ]
          },
          "through": {
            "type": "boolean"
          },
          "walkAnime": {
            "type": "boolean"
          },
          "stepAnime": {
            "type": "boolean"
          },
          "directionFix": {
            "type": "boolean"
          },
          "moveType": {
            "type": "string",
            "enum": [
              "fixed",
              "random",
              "approach",
              "custom"
            ]
          },
          "moveSpeed": {
            "type": "number"
          },
          "moveFrequency": {
            "type": "number"
          },
          "moveRoute": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "indent": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          },
          "verbose": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "eventId",
          "pageIndex"
        ]
      }
    },
    {
      "name": "create_npc",
      "description": "Create a complete, placed NPC event on a map in one call — a graphic + trigger + a talk list. Provide `text` (built into a Show Text sequence, with optional face/speaker) or an explicit `commands` array (commands wins if both given). Defaults to a solid, action-button NPC facing down. Warns (never blocks) on an unknown characterName, and on NO graphic at all (an NPC with no characterName is invisible in-game — use create_map_event for an intentionally-invisible trigger). The one-shot \"make a talking NPC that says X\" primitive.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "name": {
            "type": "string"
          },
          "characterName": {
            "type": "string"
          },
          "characterIndex": {
            "type": "number"
          },
          "direction": {
            "type": "string",
            "enum": [
              "down",
              "left",
              "right",
              "up"
            ]
          },
          "pattern": {
            "type": "number"
          },
          "text": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "faceName": {
            "type": "string"
          },
          "faceIndex": {
            "type": "number"
          },
          "speakerName": {
            "type": "string"
          },
          "commands": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "number"
                },
                "indent": {
                  "type": "number"
                },
                "parameters": {
                  "type": "array",
                  "items": {}
                }
              },
              "required": [
                "code"
              ]
            }
          },
          "trigger": {
            "type": "string",
            "enum": [
              "action_button",
              "player_touch",
              "event_touch",
              "autorun",
              "parallel"
            ]
          },
          "priority": {
            "type": "string",
            "enum": [
              "below",
              "same",
              "above"
            ]
          },
          "through": {
            "type": "boolean"
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "x",
          "y",
          "name"
        ]
      }
    },
    {
      "name": "create_chest",
      "description": "Create a complete, placed treasure chest on a map in one call — the two-page self-switch idiom done correctly, so the chest can never be looted twice. Page 1 (closed) is an action-button, priority-`same` event that optionally shows `text`, gives the contents, then flips its self switch; page 2 (opened) is gated on that self switch, shows the opened graphic and does nothing. `kind` picks the payout: item/weapon/armor (needs `id`) or gold. On the RTP `!Chest` sheet the open/closed states are the *direction* rows of one character block (down = closed, up = open), which is what closedDirection/openedDirection default to. Throws if the item/weapon/armor `id` does not exist; warns (never blocks) on an unknown characterName or a chest with no graphic.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "kind": {
            "type": "string",
            "enum": [
              "item",
              "weapon",
              "armor",
              "gold"
            ]
          },
          "id": {
            "type": "number"
          },
          "amount": {
            "type": "number"
          },
          "name": {
            "type": "string"
          },
          "characterName": {
            "type": "string"
          },
          "characterIndex": {
            "type": "number"
          },
          "closedDirection": {
            "type": "string",
            "enum": [
              "down",
              "left",
              "right",
              "up"
            ]
          },
          "openedDirection": {
            "type": "string",
            "enum": [
              "down",
              "left",
              "right",
              "up"
            ]
          },
          "text": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "selfSwitch": {
            "type": "string",
            "enum": [
              "A",
              "B",
              "C",
              "D"
            ]
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "x",
          "y",
          "kind"
        ]
      }
    },
    {
      "name": "create_transfer",
      "description": "Create a complete, placed map-transfer event in one call, using whichever of the two working idioms you pick. `idiom: \"action_button\"` (default) makes a priority-`same` event the player faces and presses — the right shape for a solid landmark (building, dungeon mouth, door); `idiom: \"player_touch\"` makes an invisible priority-`below` doormat the player walks onto — for interior exits and map-edge gaps. `direction` is the facing the player lands with, `fade` the screen transition. Throws if the destination map does not exist; warns if the destination tile is outside that map, if the characterName is unknown, or if the event can never fire from where it sits.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "targetMapId": {
            "type": "number"
          },
          "targetX": {
            "type": "number"
          },
          "targetY": {
            "type": "number"
          },
          "idiom": {
            "type": "string",
            "enum": [
              "action_button",
              "player_touch"
            ]
          },
          "name": {
            "type": "string"
          },
          "direction": {
            "type": "string",
            "enum": [
              "retain",
              "down",
              "left",
              "right",
              "up"
            ]
          },
          "fade": {
            "type": "string",
            "enum": [
              "black",
              "white",
              "none"
            ]
          },
          "characterName": {
            "type": "string"
          },
          "characterIndex": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          },
          "force": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "x",
          "y",
          "targetMapId",
          "targetX",
          "targetY"
        ]
      }
    },
    {
      "name": "list_plugin_commands",
      "description": "List every plugin command create_plugin_command can validate (plugin filename → command key → args): the plugins this project actually ships, scanned from their js/plugins/*.js annotations, merged over a small built-in allowlist. Pass pluginName to narrow to one plugin. Read-only. Use scan_plugins for the richer per-project view (arg types/defaults, enabled state); an unlisted plugin command can still be built, it just isn’t validated.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "pluginName": {
            "type": "string"
          }
        }
      }
    },
    {
      "name": "create_plugin_command",
      "description": "Build an RPG Maker MZ plugin command (event command code 357) for insertion into an event page via add_event_command. Validates against the plugins this project actually ships (scanned from their js/plugins/*.js @command/@arg annotations) merged over a small built-in allowlist — warn-by-default: an unknown plugin/command, a stray arg, or a plugin that is installed but disabled in js/plugins.js produces a warning but never blocks. Args are normalized to the editor’s string-valued shape. Read-only: returns { command, warnings? }, writes nothing.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "pluginName": {
            "type": "string"
          },
          "commandName": {
            "type": "string"
          },
          "args": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "label": {
            "type": "string"
          },
          "indent": {
            "type": "number"
          }
        },
        "required": [
          "pluginName",
          "commandName"
        ]
      }
    },
    {
      "name": "describe_tile",
      "description": "Decode a raw RPG Maker MZ tile id into its tileset sheet (A1–A5, B–E), and for autotiles its kind + shape slot (0–47) and autotile geometry (floor/wall/waterfall). Read-only inspection helper — raw tile ids are opaque integers, this makes one legible. Returns { tileId, empty, sheet, sheetIndex, autotile, kind?, shape?, autotileType? }. Pass `tilesetId` to also inspect the sheet PNG and report `transparent` (true = the tile is see-through and needs an opaque base tile on a lower layer; painting it on layer 0 alone shows the map void) + `transparentPercent`.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "tileId": {
            "type": "number"
          },
          "tilesetId": {
            "type": "number"
          }
        },
        "required": [
          "tileId"
        ]
      }
    },
    {
      "name": "get_tile_catalog",
      "description": "Get the semantic tile catalog for a tileset: the named tiles (e.g. 'Grassland A', 'Forest', 'Sea') in each of its image sheets, each with its representative tile id and a `source` ('builtin' = RPG Maker's own labels; 'project' = a draft name from the vision-bootstrap skill). Project (custom-sheet) entries also carry the skill's `description`, `confidence` ('high'/'medium'/'low'), and `manual` (true = a human verified it) so you can gauge how trustworthy a draft name is. Autotile entries (A1–A4) return the kind's base tile id — feed it to a paint command, which recomputes the shape from neighbours. Covers the default Overworld tileset (World_A1/A2/B/C) plus any custom sheets cataloged into data/tilecatalog/ (via the tileset-catalog skill); still-uncovered sheets are omitted. **Called WITHOUT `sheet` it returns only a per-sheet index (name + entry count) to stay within the tool-output limit — a full tileset can hold thousands of named tiles. Pass `sheet` (filename 'World_A2' or slot role 'A2') to list one sheet's actual tile entries.** Sheet-filtered entries also carry `transparent` (true = the tile is see-through and needs an opaque base tile on a lower layer — painting it on layer 0 alone shows the map void; e.g. trees/objects/overlays). Read-only.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "tilesetId": {
            "type": "number"
          },
          "sheet": {
            "type": "string"
          }
        },
        "required": [
          "tilesetId"
        ]
      }
    },
    {
      "name": "find_tile",
      "description": "Find tiles in a tileset by a case-insensitive SUBSTRING match on their catalog name — a quick bridge from a name fragment like 'grass' or 'forest' to a paintable tile id. This is a literal substring match, NOT synonym/semantic search: 'water' matches 'Endless Waterfall' but not 'Sea' or 'Pond' (their names lack the substring). To browse the actual tile names first, use get_tile_catalog with a `sheet` filter, then search a fragment you see. Set `searchDescriptions: true` to also match the free-text description a project catalog carries (custom sheets named by the tileset-catalog skill — their names are terse, the descriptions say what the tile looks like); built-in RPG Maker entries have no description, so this only widens the search over custom sheets. Returns matching catalog entries (name, sheet, tile id, autotile kind, `source`, `matchedIn` [which fields matched], `transparent` [true = needs an opaque base on a lower layer], plus `description`/`confidence`/`manual` for project catalog drafts). Covers the default Overworld tileset plus custom sheets cataloged into data/tilecatalog/ (via the tileset-catalog skill). Read-only.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "tilesetId": {
            "type": "number"
          },
          "query": {
            "type": "string"
          },
          "searchDescriptions": {
            "type": "boolean"
          }
        },
        "required": [
          "tilesetId",
          "query"
        ]
      }
    },
    {
      "name": "paint_tiles",
      "description": "Paint specific tiles onto a map, with automatic autotiling. Each cell is set to its tile id; if that id is an autotile (A1-A4, e.g. a catalog 'kind' base from find_tile), its shape and its neighbours' shapes are recomputed from same-kind adjacency so borders/corners line up. Flat tiles are painted as-is. Defaults to the lower ground layer (0). Higher-level than set_map_tile, which is a single raw tile with no autotiling.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "tiles": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "x": {
                  "type": "number"
                },
                "y": {
                  "type": "number"
                },
                "tileId": {
                  "type": "number"
                }
              },
              "required": [
                "x",
                "y",
                "tileId"
              ]
            }
          },
          "layer": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "tiles"
        ]
      }
    },
    {
      "name": "fill_area",
      "description": "Fill a rectangular area of a map with one tile id, with automatic autotiling — a filled autotile region borders itself correctly (and re-borders any same-kind tiles it touches). Flat tiles fill uniformly. Defaults to the lower ground layer (0). For region ids, fill layer 5 with the region number as tileId.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "width": {
            "type": "number"
          },
          "height": {
            "type": "number"
          },
          "tileId": {
            "type": "number"
          },
          "layer": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "x",
          "y",
          "width",
          "height",
          "tileId"
        ]
      }
    },
    {
      "name": "object_tiles",
      "description": "Expand a top-left flat tile id + a width×height size into the grid of tile ids that object occupies on the sheet — feed the returned `tiles` straight into place_object. This handles the flat sheets' two-half-column layout, where the tile below id N is NOT N+16 (indices 0–127 are the left half of the sheet, 128–255 the right), which is otherwise painful to compute by hand. Get the top-left id from find_tile/get_tile_catalog. Read-only. Throws if topLeftId isn't a flat id or the rectangle runs off the 16×16 sheet; warns if the tileset lacks that sheet.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "tilesetId": {
            "type": "number"
          },
          "topLeftId": {
            "type": "number"
          },
          "width": {
            "type": "number"
          },
          "height": {
            "type": "number"
          }
        },
        "required": [
          "tilesetId",
          "topLeftId",
          "width",
          "height"
        ]
      }
    },
    {
      "name": "place_object",
      "description": "Place a multi-tile B/C object (a house, tree, fountain, …) on a map and report its passability. `tiles` is the object's block of flat tile ids as rows (top to bottom), each row left to right; a 0 leaves that cell untouched so L-shaped/irregular objects work. Stamped onto the upper tile layer (2) by default so it draws over the ground. Unlike paint_tiles this does NOT autotile (objects are flat sheet tiles) — instead it uses the tileset flags to warn when a footprint cell sits on impassable terrain or overwrites an existing tile, and returns the resulting per-cell passability plus the `collision` cells the object turns into a solid obstacle. Warn-by-default: never refuses a placement. Get tile ids from find_tile/get_tile_catalog.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "tiles": {
            "type": "array",
            "items": {
              "type": "array",
              "items": {
                "type": "number"
              }
            }
          },
          "layer": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "x",
          "y",
          "tiles"
        ]
      }
    },
    {
      "name": "get_tilesets",
      "description": "List every tileset in the project with its id, name, mode (0 world / 1 area), and the image sheets it uses (labelled A1–A4, A5, B–E; empty slots omitted). Use this to discover valid tilesetId values (needed by find_tile, get_tile_catalog, paint_tiles, fill_area, place_object, get_tile_flags, set_tile_flags, check_passability) and to see which sheets each tileset is built from. For a plain id→name list, list_names(type:\"tilesets\") is even cheaper. Read-only.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "get_tile_flags",
      "description": "Decode a tileset's flag word for a single tile id into a legible view: 4-direction passability (down/left/right/up — true = walkable that way), the [*] 'star' overlay bit, ladder/bush/counter/damage-floor flags, and terrain tag (0–7). Read-only inspection of data/Tilesets.json flags[]. Note passability here is for the tile in isolation; a real cell's passability layers its stacked tiles — use check_passability for that. Returns { tilesetId, tileId, tile, flags }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "tilesetId": {
            "type": "number"
          },
          "tileId": {
            "type": "number"
          }
        },
        "required": [
          "tilesetId",
          "tileId"
        ]
      }
    },
    {
      "name": "check_passability",
      "description": "Check whether a map cell can be walked onto, reproducing the engine's layered passage rule: the stacked tiles at (x, y) are examined upper-layer first, and the first non-[*] tile decides each direction. Reads the map's tileset flags. Returns per-direction passability (down/left/right/up — true = a character can walk off the cell that way), the cell's terrain tag, the stacked tile ids, and — when `direction` is given — a single `passable` boolean for that direction. Read-only.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "direction": {
            "type": "string",
            "enum": [
              "down",
              "left",
              "right",
              "up"
            ]
          }
        },
        "required": [
          "mapId",
          "x",
          "y"
        ]
      }
    },
    {
      "name": "set_tile_flags",
      "description": "Edit a tile's passability/terrain/behaviour flags in a tileset's flags[] array (the write side of get_tile_flags). Only the fields you pass change — everything else on the tile is preserved (a non-destructive merge onto the current flag word). `passage` is walkability (down/left/right/up, true = a character can walk off that way). Also settable: star ([*] overlay), ladder, bush, counter, damage (damage floor), and terrainTag (0–7). For an autotile id (A1–A4) the change is applied to all 48 shape slots of its kind by default (set applyToAutotileKind:false to touch only the exact id) so painting any border shape keeps the same passability. Writes data/Tilesets.json through the commit choke point (dry-run/diff). Returns { tilesetId, tileId, appliedTileCount, before, after }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "tilesetId": {
            "type": "number"
          },
          "tileId": {
            "type": "number"
          },
          "passage": {
            "type": "object",
            "properties": {
              "down": {
                "type": "boolean"
              },
              "left": {
                "type": "boolean"
              },
              "right": {
                "type": "boolean"
              },
              "up": {
                "type": "boolean"
              }
            }
          },
          "star": {
            "type": "boolean"
          },
          "ladder": {
            "type": "boolean"
          },
          "bush": {
            "type": "boolean"
          },
          "counter": {
            "type": "boolean"
          },
          "damage": {
            "type": "boolean"
          },
          "terrainTag": {
            "type": "number"
          },
          "applyToAutotileKind": {
            "type": "boolean"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "tilesetId",
          "tileId"
        ]
      }
    },
    {
      "name": "get_system",
      "description": "Get system data",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "get_variables",
      "description": "Get all game variable names",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "set_variable_name",
      "description": "Set a variable name. Grows the project's variable list if the id is past the end (padded to the editor's 20-slot block), so an id from next_free_id can always be labelled. Naming a variable as soon as you claim it is what makes it visible to the next session — see list_allocated_ids.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "variableId": {
            "type": "number"
          },
          "name": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "variableId",
          "name"
        ]
      }
    },
    {
      "name": "get_switches",
      "description": "Get all game switch names",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "set_switch_name",
      "description": "Set a switch name. Grows the project's switch list if the id is past the end (padded to the editor's 20-slot block), so an id from next_free_id can always be labelled. Naming a switch as soon as you claim it is what makes it visible to the next session — see list_allocated_ids.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "switchId": {
            "type": "number"
          },
          "name": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "switchId",
          "name"
        ]
      }
    },
    {
      "name": "get_game_title",
      "description": "Get the game title",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "update_game_title",
      "description": "Update the game title",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "title": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "title"
        ]
      }
    },
    {
      "name": "get_title_screen",
      "description": "Get the title screen settings: title1Name/title2Name (background layers, from list_assets(\"titles1\"/\"titles2\") — title2Name draws over title1Name), titleBgm (the AudioFile that plays while it is shown), and drawTitle (whether the game title text is drawn over the art).",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "update_title_screen",
      "description": "Update the title screen: background layers (title1Name/title2Name, basenames from list_assets(\"titles1\"/\"titles2\")), the BGM that plays while it is shown, and/or whether the game title text is drawn over the art. Only the provided fields are changed. Warns (never blocks) when an image/audio name is not a known asset. Returns the updated title screen settings.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "title1Name": {
            "type": "string"
          },
          "title2Name": {
            "type": "string"
          },
          "titleBgm": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "volume": {
                "type": "number"
              },
              "pitch": {
                "type": "number"
              },
              "pan": {
                "type": "number"
              }
            },
            "required": [
              "name"
            ]
          },
          "drawTitle": {
            "type": "boolean"
          },
          "dryRun": {
            "type": "boolean"
          }
        }
      }
    },
    {
      "name": "get_starting_position",
      "description": "Get the game starting position ({ mapId, x, y })",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "update_starting_position",
      "description": "Update the game starting position",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "mapId",
          "x",
          "y"
        ]
      }
    },
    {
      "name": "get_party",
      "description": "Get the starting party — the actor ids the game begins with. Returns `{ partyMembers }`, rhyming with set_party's input/output shape.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "set_party",
      "description": "Set the starting party (the actor ids the game begins with, in order). Every id must reference an existing actor.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "partyMembers": {
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "partyMembers"
        ]
      }
    },
    {
      "name": "get_terms",
      "description": "Get the game vocabulary/terms: the `basic`, `commands`, `params` string arrays and the `messages` map (menu labels, system messages).",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "set_term",
      "description": "Set one vocabulary term. For category 'basic'/'commands'/'params' the key is a numeric index (as a string); for 'messages' it's a message key (e.g. 'actorDamage'). Returns the updated terms.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "category": {
            "type": "string",
            "enum": [
              "basic",
              "commands",
              "params",
              "messages"
            ]
          },
          "key": {
            "type": "string"
          },
          "value": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "category",
          "key",
          "value"
        ]
      }
    },
    {
      "name": "get_types",
      "description": "Get one System.json type-name array — the named lists other data references by index: elements, skillTypes, weaponTypes, armorTypes, or equipTypes.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "category": {
            "type": "string",
            "enum": [
              "elements",
              "skillTypes",
              "weaponTypes",
              "armorTypes",
              "equipTypes"
            ]
          }
        },
        "required": [
          "category"
        ]
      }
    },
    {
      "name": "set_type_name",
      "description": "Rename one entry in a System.json type-name array (elements/skillTypes/weaponTypes/armorTypes/equipTypes). Index 0 is the conventional empty slot. Returns the updated array.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "category": {
            "type": "string",
            "enum": [
              "elements",
              "skillTypes",
              "weaponTypes",
              "armorTypes",
              "equipTypes"
            ]
          },
          "index": {
            "type": "number"
          },
          "name": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "category",
          "index",
          "name"
        ]
      }
    },
    {
      "name": "set_currency_unit",
      "description": "Set the currency unit shown next to gold amounts (e.g. \"G\", \"Gold\").",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "unit": {
            "type": "string"
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "unit"
        ]
      }
    },
    {
      "name": "list_assets",
      "description": "List the available asset filenames (extension stripped) for one asset kind — the exact names RPG Maker's data references (a sprite/face/tileset/audio name). Use it to validate a graphic or audio name before wiring it into an event; a wrong filename fails silently at runtime. Fails soft: an unused asset directory returns an empty list.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "characters",
              "faces",
              "tilesets",
              "pictures",
              "parallaxes",
              "battlebacks1",
              "battlebacks2",
              "enemies",
              "sv_actors",
              "sv_enemies",
              "titles1",
              "titles2",
              "system",
              "bgm",
              "bgs",
              "me",
              "se"
            ]
          }
        },
        "required": [
          "type"
        ]
      }
    },
    {
      "name": "list_names",
      "description": "Cheap names-only index for a database table. Returns { id, name } entries instead of full records — use it to look up or sanity-check IDs before wiring them into events, without paying the token cost of a full get_*/search_* dump.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "actors",
              "classes",
              "items",
              "weapons",
              "armors",
              "skills",
              "enemies",
              "troops",
              "states",
              "common_events",
              "tilesets",
              "maps"
            ]
          }
        },
        "required": [
          "type"
        ]
      }
    },
    {
      "name": "get_database",
      "description": "Read a database table in full: actors, classes, items, weapons, armors, skills, enemies, troops, states, or common_events. Returns the raw 1-indexed array (slot 0 is null), or — with `id` — that single record, or null if no such record exists. These are full records: prefer list_names for an id→name index, or search_actors/search_items/search_skills to find records by name, and reach for this only when you need every field. Maps and tilesets are not here: use get_map_infos/get_map and get_tilesets/get_tile_flags. Read-only.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "actors",
              "classes",
              "items",
              "weapons",
              "armors",
              "skills",
              "enemies",
              "troops",
              "states",
              "common_events"
            ]
          },
          "id": {
            "type": "number"
          }
        },
        "required": [
          "type"
        ]
      }
    },
    {
      "name": "validate_event",
      "description": "Validate a single event's command lists against the known RPG Maker MZ command table. Read-only: reports parameter/structure warnings without changing anything.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "mapId": {
            "type": "number"
          },
          "eventId": {
            "type": "number"
          }
        },
        "required": [
          "mapId",
          "eventId"
        ]
      }
    },
    {
      "name": "validate_project",
      "description": "Validate the event command lists of every map in the project. Read-only: returns aggregated, map-tagged warnings for auditing before or after a batch of edits.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "validate_references",
      "description": "Audit cross-file reference integrity across the whole project (read-only, warn-by-default): Transfer Player targets and starting position point at existing maps; starting party, actor classes, class/enemy skills, troop members, enemy drops, and skill/item effects (states, learned skills, common events, animations) all resolve; and the map tree has no dangling or cyclic parentId. Complements validate_project (which checks command shape). Returns { ok, warnings[] }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "validate_assets",
      "description": "Audit asset-filename integrity across the whole project (read-only, warn-by-default): every image/audio name field — actor characterName/faceName/battlerName, enemy battlerName, tileset sheets, map bgm/bgs/parallax/battlebacks, event page graphics, event Play BGM/BGS/ME/SE / Show Picture / Show Text face / Change Actor Images, and system titles/battlebacks/default audio/vehicle graphics — is checked against the files present under img/ and audio/. Catches a wrong filename (e.g. a battlerName with no matching img/enemies/*.png) before it becomes a runtime \"Failed to load\" error. An asset kind whose directory is empty/missing is skipped (not flagged). Complements validate_references (which checks id integrity). Returns { ok, warnings[] }.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "list_allocated_ids",
      "description": "Show which switch / variable / common-event IDs are already spoken for, derived from the project's own JSON (never a hand-maintained list, which would drift the moment someone edited in the RPG Maker editor). An id counts as allocated if it is declared (a System.json label, a CommonEvents row) OR referenced anywhere — event page conditions and command lists, common events, troop pages, and Common Event skill/item effects. Use this before reusing an id, and pass `id` to answer \"where is switch 23 actually used?\" before touching it. Returns { count, highest, gaps, declaredCapacity, allocated[], coverage }. Read-only. To claim a fresh id instead, use next_free_id.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "switch",
              "variable",
              "common_event"
            ]
          },
          "id": {
            "type": "number"
          }
        },
        "required": [
          "type"
        ]
      }
    },
    {
      "name": "next_free_id",
      "description": "Reserve the next unallocated switch / variable / common-event ID(s) instead of picking one by hand. Ids are handed out strictly above every id already declared or referenced, so two sessions editing the same project over time cannot silently claim the same switch — a collision that never crashes and only surfaces hours into a playtest as a door that is inexplicably already open. Pass `reuseGaps: true` to fill holes below the highest id first (off by default: a hole is often an id claimed in notes but not yet written). Read-only — it suggests ids, it does not write them; name what you take with set_switch_name / set_variable_name so the next session sees the claim.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "switch",
              "variable",
              "common_event"
            ]
          },
          "count": {
            "type": "number"
          },
          "reuseGaps": {
            "type": "boolean"
          }
        },
        "required": [
          "type"
        ]
      }
    },
    {
      "name": "batch_create",
      "description": "Create many database records of one type in a single call and a single file write — the batch sibling of create_actor/create_item/create_weapon/create_armor/create_skill/create_enemy/create_state/create_class. Each entry in `records` takes the same fields its single create_* tool accepts (only `name` is required for most; omitted fields use the editor's defaults). Ids are allocated sequentially from the current max, so a record can reference a sibling created earlier in the same batch. Use this instead of N sequential create_* calls when authoring a cast, a loot table, or a skill list. Returns `{ type, count, created, warnings? }` (classes are summarized like create_class; enemy battlerName misses are warnings, never blocked). Throws — writing nothing at all — if any record references a database id that does not exist, naming the offending records[i].",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "actor",
              "item",
              "weapon",
              "armor",
              "skill",
              "enemy",
              "state",
              "class"
            ]
          },
          "records": {
            "type": "array",
            "items": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            }
          },
          "dryRun": {
            "type": "boolean"
          }
        },
        "required": [
          "type",
          "records"
        ]
      }
    },
    {
      "name": "scan_plugins",
      "description": "Discover the plugin commands this project actually has, by parsing the @command/@arg annotations in js/plugins/*.js and the enabled/disabled state in js/plugins.js. Use it to find out what create_plugin_command can call and with which args — it reports every command's key, label, description and args (name/type/default), plus whether the plugin is enabled in the editor's Plugin Manager (a disabled plugin's commands never run). create_plugin_command validates against this scan automatically, so you don't need to call this first; it's for discovery. Pass pluginName to narrow to one plugin, or enabledOnly:true to skip plugins that are installed but switched off. Read-only. NOTE: MZ has no 'required argument' annotation, so scanned args are checked for unknown names only, never for missing ones.",
      "inputSchema": {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
          "pluginName": {
            "type": "string"
          },
          "enabledOnly": {
            "type": "boolean"
          }
        }
      }
    }
  ]
}
