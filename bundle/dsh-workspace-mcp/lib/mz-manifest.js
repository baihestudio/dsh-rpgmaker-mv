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
            "type": "string",
            "description": "Path to the RPG Maker MZ project directory (a leading ~ is expanded)."
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the actor to update"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {},
            "description": "Object containing actor properties to update"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
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
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "faceName": {
            "type": "string"
          },
          "faceIndex": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
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
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "The search term to find actors"
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
            "type": "string",
            "description": "Item name"
          },
          "description": {
            "description": "In-game description text",
            "type": "string"
          },
          "iconIndex": {
            "description": "Icon index (IconSet.png)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "itypeId": {
            "description": "Item type: 1 Regular, 2 Key Item, 3 Hidden A, 4 Hidden B",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "scope": {
            "description": "Target scope (0 none, 1 one enemy, 7 one ally, …)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "occasion": {
            "description": "Usable: 0 always, 1 battle, 2 menu, 3 never",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "price": {
            "description": "Buy price (sells for half)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "consumable": {
            "description": "Consumed on use",
            "type": "boolean"
          },
          "successRate": {
            "description": "Success rate percent",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "repeats": {
            "description": "Number of hits/repeats",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "tpGain": {
            "description": "User TP gained on use",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "hitType": {
            "description": "0 certain, 1 physical, 2 magical",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "animationId": {
            "description": "Animation id shown on use",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "damage": {
            "description": "Damage object { type, elementId, formula, variance, critical }",
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "effects": {
            "description": "Effect objects { code, dataId, value1, value2 }",
            "type": "array",
            "items": {}
          },
          "note": {
            "description": "Note field",
            "type": "string"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the item to update"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {},
            "description": "Object containing item properties to update"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "The search term to find items"
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
            "type": "string",
            "description": "Weapon name"
          },
          "description": {
            "description": "In-game description text",
            "type": "string"
          },
          "iconIndex": {
            "description": "Icon index (IconSet.png)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "wtypeId": {
            "description": "Weapon type id (System.json weaponTypes)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "price": {
            "description": "Buy price",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "params": {
            "description": "8 flat stat bonuses [maxHP, maxMP, atk, def, mat, mdf, agi, luk]",
            "minItems": 8,
            "maxItems": 8,
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "animationId": {
            "description": "Attack animation id",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "traits": {
            "description": "Trait objects { code, dataId, value }",
            "type": "array",
            "items": {}
          },
          "note": {
            "description": "Note field",
            "type": "string"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the weapon to update"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {},
            "description": "Object containing weapon properties to update"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "Armor name"
          },
          "description": {
            "description": "In-game description text",
            "type": "string"
          },
          "iconIndex": {
            "description": "Icon index (IconSet.png)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "atypeId": {
            "description": "Armor type id (System.json armorTypes)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "etypeId": {
            "description": "Equip slot (equipTypes: 2 Shield, 3 Head, 4 Body, 5 Accessory)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "price": {
            "description": "Buy price",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "params": {
            "description": "8 flat stat bonuses [maxHP, maxMP, atk, def, mat, mdf, agi, luk]",
            "minItems": 8,
            "maxItems": 8,
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "traits": {
            "description": "Trait objects { code, dataId, value }",
            "type": "array",
            "items": {}
          },
          "note": {
            "description": "Note field",
            "type": "string"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the armor to update"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {},
            "description": "Object containing armor properties to update"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "Skill name"
          },
          "description": {
            "description": "Skill description",
            "type": "string"
          },
          "iconIndex": {
            "description": "Icon index (0-1000+)",
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "mpCost": {
            "description": "MP cost",
            "type": "number"
          },
          "tpCost": {
            "description": "TP cost",
            "type": "number"
          },
          "scope": {
            "description": "Target scope (1=enemy single, 2=enemy all, 7=ally all, etc.)",
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "damage": {
            "description": "Damage configuration",
            "type": "object",
            "properties": {
              "type": {
                "description": "Damage type (0=none, 1=HP damage, 3=HP recover, etc.)",
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              "elementId": {
                "description": "Element ID (0=none, 2=fire, 3=ice, etc.)",
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              "formula": {
                "description": "Damage formula (e.g., \"a.mat * 4 - b.mdf * 2\")",
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
            "description": "Skill effects (buffs, debuffs, states, etc.)",
            "type": "array",
            "items": {}
          },
          "animationId": {
            "description": "Animation ID",
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "message1": {
            "description": "Battle message",
            "type": "string"
          },
          "stypeId": {
            "description": "Skill type (1=magic, 2=special, etc.)",
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "Skill name"
          },
          "damageFormula": {
            "type": "string",
            "description": "Damage formula (e.g., \"a.mat * 4\")"
          },
          "mpCost": {
            "type": "number",
            "description": "MP cost"
          },
          "scope": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Target scope (1=enemy single, 2=enemy all)"
          },
          "elementId": {
            "description": "Element ID (0=none, 2=fire, 3=ice, 4=thunder)",
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "description": {
            "description": "Skill description",
            "type": "string"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "Skill name"
          },
          "healFormula": {
            "type": "string",
            "description": "Heal formula (e.g., \"a.mat * 3 + 100\")"
          },
          "mpCost": {
            "type": "number",
            "description": "MP cost"
          },
          "scope": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Target scope (7=ally all, 11=user)"
          },
          "description": {
            "description": "Skill description",
            "type": "string"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "Skill name"
          },
          "buffType": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Buff type (2=ATK, 3=DEF, 4=MAT, 5=MDF, 6=AGI)"
          },
          "turns": {
            "type": "number",
            "description": "Number of turns the buff lasts"
          },
          "mpCost": {
            "type": "number",
            "description": "MP cost"
          },
          "scope": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Target scope (7=ally all, 11=user)"
          },
          "description": {
            "description": "Skill description",
            "type": "string"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "Skill name"
          },
          "stateId": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "State ID (4=poison, 5=blind, 6=silence, 8=confusion, etc.)"
          },
          "chance": {
            "type": "number",
            "description": "Success chance (0.0-1.0)"
          },
          "mpCost": {
            "type": "number",
            "description": "MP cost"
          },
          "scope": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Target scope (1=enemy single, 2=enemy all)"
          },
          "description": {
            "description": "Skill description",
            "type": "string"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The skill ID to update"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {},
            "description": "Properties to update"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "Search term"
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map to retrieve"
          },
          "includeData": {
            "description": "Include the full tile `data` array (default true). Pass false to omit it (returns dataTileCount) and avoid the token cost of a big painted map.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "x": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Left edge of the window (tile column)"
          },
          "y": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Top edge of the window (tile row)"
          },
          "width": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "Window width in tiles"
          },
          "height": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "Window height in tiles"
          },
          "layer": {
            "description": "Z-layer 0-5 (0-1 lower, 2-3 upper, 4 shadow, 5 region); default 0",
            "type": "integer",
            "minimum": 0,
            "maximum": 5
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
            "type": "string",
            "description": "Map name shown in the editor map tree"
          },
          "width": {
            "description": "Width in tiles (default 17)",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "height": {
            "description": "Height in tiles (default 13)",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "parentId": {
            "description": "Parent map id in the tree; 0 (default) = top level",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "tilesetId": {
            "description": "Tileset id (default 1)",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map to delete"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
                  "type": "integer",
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991,
                  "description": "The map to update"
                },
                "parentId": {
                  "description": "New parent map id; 0 = top level",
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991
                },
                "order": {
                  "description": "New sort order among siblings",
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991
                },
                "name": {
                  "description": "New tree display name",
                  "type": "string"
                },
                "expanded": {
                  "description": "Whether the node is expanded in the tree",
                  "type": "boolean"
                }
              },
              "required": [
                "mapId"
              ]
            },
            "description": "One or more per-map tree edits to apply together"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "eventId": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the event"
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "eventId": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the event"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {},
            "description": "Object containing event properties to update"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
            "type": "boolean"
          },
          "verbose": {
            "description": "Echo the full written record instead of the default summary. Off by default: the response reports identity, counts and command-list shape, which is what you would assert on, and omits the parameters/conditions you would only re-read. Read the full record with the matching get_* tool.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "name": {
            "type": "string",
            "description": "Event name"
          },
          "x": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "X tile position"
          },
          "y": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Y tile position"
          },
          "note": {
            "description": "Event note field",
            "type": "string"
          },
          "pages": {
            "description": "Event pages; each is merged onto a blank page so you can pass only the differing fields. Omit for one blank page.",
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
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "searchTerm": {
            "type": "string",
            "description": "The search term to find events"
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "eventId": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the event"
          },
          "pageIndex": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Zero-based page index"
          },
          "command": {
            "type": "object",
            "properties": {
              "code": {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991,
                "description": "Event command code (see RPG Maker MZ documentation)"
              },
              "indent": {
                "default": 0,
                "description": "Indentation level",
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              "parameters": {
                "type": "array",
                "items": {},
                "description": "Command parameters"
              }
            },
            "required": [
              "code",
              "parameters"
            ],
            "description": "The event command to insert"
          },
          "position": {
            "description": "Insertion index; defaults to end of the list",
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
            "type": "boolean"
          },
          "verbose": {
            "description": "Echo the full written record instead of the default summary. Off by default: the response reports identity, counts and command-list shape, which is what you would assert on, and omits the parameters/conditions you would only re-read. Read the full record with the matching get_* tool.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {},
            "description": "Partial MapData properties to merge"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "verbose": {
            "description": "Echo the full written record instead of the default summary. Off by default: the response reports identity, counts and command-list shape, which is what you would assert on, and omits the parameters/conditions you would only re-read. Read the full record with the matching get_* tool.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map to resize"
          },
          "width": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "New width in tiles"
          },
          "height": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "New height in tiles"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "verbose": {
            "description": "Echo the full written record instead of the default summary. Off by default: the response reports identity, counts and command-list shape, which is what you would assert on, and omits the parameters/conditions you would only re-read. Read the full record with the matching get_* tool.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "encounters": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "troopId": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "Troop id from Troops.json"
                },
                "weight": {
                  "description": "Relative encounter weight (default 5)",
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991
                },
                "regionSet": {
                  "description": "Region ids this encounter is restricted to (empty = anywhere)",
                  "type": "array",
                  "items": {
                    "type": "integer",
                    "minimum": -9007199254740991,
                    "maximum": 9007199254740991
                  }
                }
              },
              "required": [
                "troopId"
              ]
            },
            "description": "The full encounter list to set (replaces any existing entries)"
          },
          "encounterStep": {
            "description": "Average number of steps between encounters (unchanged if omitted)",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "x": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "X tile position"
          },
          "y": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Y tile position"
          },
          "layer": {
            "type": "integer",
            "minimum": 0,
            "maximum": 5,
            "description": "Z-layer 0-5 (0-1 lower, 2-3 upper, 4 shadow, 5 region)"
          },
          "tileId": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Raw tile ID"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "eventId": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the event"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "Enemy name shown in battle and the database"
          },
          "battlerName": {
            "description": "Battler graphic filename (img/enemies)",
            "type": "string"
          },
          "battlerHue": {
            "description": "Battler hue rotation 0-360",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "params": {
            "description": "8 base params: [maxHP, maxMP, atk, def, mat, mdf, agi, luk]",
            "minItems": 8,
            "maxItems": 8,
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "exp": {
            "description": "EXP granted when defeated",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "gold": {
            "description": "Gold granted when defeated",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "note": {
            "description": "Note field",
            "type": "string"
          },
          "traits": {
            "description": "Trait objects { code, dataId, value }",
            "type": "array",
            "items": {}
          },
          "dropItems": {
            "description": "Drop-item objects { kind, dataId, denominator }",
            "type": "array",
            "items": {}
          },
          "actions": {
            "description": "Action patterns { skillId, conditionType, conditionParam1, conditionParam2, rating }",
            "type": "array",
            "items": {}
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the enemy to update"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {},
            "description": "Object containing enemy properties to update"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "The search term to find enemies"
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
            "type": "string",
            "description": "Troop name shown in the database"
          },
          "members": {
            "description": "Placed enemies; each references an existing enemyId",
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "enemyId": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "Enemy id from Enemies.json"
                },
                "x": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "X screen position of the enemy in battle"
                },
                "y": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "Y screen position of the enemy in battle"
                },
                "hidden": {
                  "default": false,
                  "description": "Whether the enemy starts hidden",
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
            "description": "Battle-event pages { conditions, list, span }; defaults to one blank page",
            "type": "array",
            "items": {}
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
            "type": "boolean"
          },
          "verbose": {
            "description": "Echo the full written record instead of the default summary. Off by default: the response reports identity, counts and command-list shape, which is what you would assert on, and omits the parameters/conditions you would only re-read. Read the full record with the matching get_* tool.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the troop to update"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {},
            "description": "Object containing troop properties to update (name, members, pages)"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
            "type": "boolean"
          },
          "verbose": {
            "description": "Echo the full written record instead of the default summary. Off by default: the response reports identity, counts and command-list shape, which is what you would assert on, and omits the parameters/conditions you would only re-read. Read the full record with the matching get_* tool.",
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
            "type": "string",
            "description": "The search term to find troops"
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
            "type": "string",
            "description": "Class name shown in the database"
          },
          "maxLevel": {
            "description": "Highest level the param curve covers (default 99); sizes the params matrix",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "expParams": {
            "description": "EXP curve: [basis, extra, accelerationA, accelerationB]",
            "minItems": 4,
            "maxItems": 4,
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "params": {
            "description": "8 param growth curves, each maxLevel+1 long: [maxHP,maxMP,atk,def,mat,mdf,agi,luk]",
            "type": "array",
            "items": {
              "type": "array",
              "items": {
                "type": "number"
              }
            }
          },
          "learnings": {
            "description": "Learned-skill entries { level, skillId, note }",
            "type": "array",
            "items": {}
          },
          "traits": {
            "description": "Trait objects { code, dataId, value }",
            "type": "array",
            "items": {}
          },
          "note": {
            "description": "Note field",
            "type": "string"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the class to update"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {},
            "description": "Object containing class properties to update"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the class to add the learning to"
          },
          "skillId": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The skill learned (must exist in data/Skills.json)"
          },
          "level": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Level at which the skill is learned"
          },
          "note": {
            "description": "Optional note for the learning entry",
            "type": "string"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the class to edit"
          },
          "paramId": {
            "type": "integer",
            "minimum": 0,
            "maximum": 7,
            "description": "Which param: 0 maxHP,1 maxMP,2 atk,3 def,4 mat,5 mdf,6 agi,7 luk"
          },
          "values": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "description": "New curve, indexed by level; must match the existing curve length"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "State name shown in the database and battle messages"
          },
          "restriction": {
            "description": "Behavior restriction: 0 none, 1 attack enemy, 2 attack anyone, 3 attack ally, 4 cannot move",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "priority": {
            "description": "Icon-slot display priority 0-100 (default 50)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "motion": {
            "description": "SV-actor motion (0 normal, 2 sleep, 3 dead, …)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "overlay": {
            "description": "Overlay animation index (0 = none)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "removeAtBattleEnd": {
            "description": "Remove automatically when the battle ends",
            "type": "boolean"
          },
          "removeByRestriction": {
            "description": "Remove when the battler's restriction changes",
            "type": "boolean"
          },
          "autoRemovalTiming": {
            "description": "Auto-removal timing: 0 none, 1 at action end, 2 at turn end",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "minTurns": {
            "description": "Minimum duration in turns when auto-removed",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "maxTurns": {
            "description": "Maximum duration in turns when auto-removed",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "removeByDamage": {
            "description": "Remove when the battler takes damage",
            "type": "boolean"
          },
          "chanceByDamage": {
            "description": "Chance (%) of removal per damage instance when removeByDamage",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "removeByWalking": {
            "description": "Remove after walking a number of steps",
            "type": "boolean"
          },
          "stepsToRemove": {
            "description": "Steps to walk off the state when removeByWalking",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "releaseByDamage": {
            "description": "Whether damage can release the state",
            "type": "boolean"
          },
          "iconIndex": {
            "description": "Icon shown on the battler/status (0 = none)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "message1": {
            "description": "Message when an actor gains the state",
            "type": "string"
          },
          "message2": {
            "description": "Message when an enemy gains the state",
            "type": "string"
          },
          "message3": {
            "description": "Message when the state persists",
            "type": "string"
          },
          "message4": {
            "description": "Message when the state is removed",
            "type": "string"
          },
          "messageType": {
            "description": "Engine's message routing form",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "traits": {
            "description": "Trait objects { code, dataId, value }",
            "type": "array",
            "items": {}
          },
          "note": {
            "description": "Note field",
            "type": "string"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the state to update"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {},
            "description": "Object containing state properties to update"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "Common event name shown in the database"
          },
          "trigger": {
            "description": "How it runs on its own: 0 None (call-only), 1 Autorun, 2 Parallel",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "switchId": {
            "description": "Switch that gates an Autorun/Parallel trigger (ignored when trigger is 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "list": {
            "description": "Event-command list { code, indent, parameters }; must end with code 0",
            "type": "array",
            "items": {}
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
            "type": "boolean"
          },
          "verbose": {
            "description": "Echo the full written record instead of the default summary. Off by default: the response reports identity, counts and command-list shape, which is what you would assert on, and omits the parameters/conditions you would only re-read. Read the full record with the matching get_* tool.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the common event to update"
          },
          "updates": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {},
            "description": "Object containing common event properties to update (name, trigger, switchId, list)"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
            "type": "boolean"
          },
          "verbose": {
            "description": "Echo the full written record instead of the default summary. Off by default: the response reports identity, counts and command-list shape, which is what you would assert on, and omits the parameters/conditions you would only re-read. Read the full record with the matching get_* tool.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the common event to call (must exist)"
          },
          "indent": {
            "description": "Indentation level in the target list (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            ],
            "description": "patrol (walk a direction and back), approach (toward player), flee (away from player), wander (random), or custom (your own move commands)"
          },
          "direction": {
            "description": "patrol only: primary direction, walked out and back (default right)",
            "type": "string",
            "enum": [
              "up",
              "down",
              "left",
              "right"
            ]
          },
          "steps": {
            "description": "patrol only: steps per leg (default 3)",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "commands": {
            "description": "custom only: raw move commands { code, parameters }",
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "Move-route command code (Game_Character ROUTE_*)"
                },
                "parameters": {
                  "description": "Command parameters (default [])",
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
            "description": "Loop the route (patterns loop by default)",
            "type": "boolean"
          },
          "skippable": {
            "description": "Skip a step when movement is blocked",
            "type": "boolean"
          },
          "wait": {
            "description": "Wait for the route to finish before continuing",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "eventId": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the event"
          },
          "pageIndex": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Zero-based page index"
          },
          "characterId": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Target character: -1 player, 0 this event, N event id on the map"
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
                      "type": "integer",
                      "minimum": -9007199254740991,
                      "maximum": 9007199254740991,
                      "description": "Move-route command code (Game_Character ROUTE_*)"
                    },
                    "parameters": {
                      "description": "Command parameters (default [])",
                      "type": "array",
                      "items": {}
                    }
                  },
                  "required": [
                    "code"
                  ]
                },
                "description": "Move commands; auto-terminated with code 0 if missing"
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
            ],
            "description": "The move route to force (e.g. from create_move_route)"
          },
          "indent": {
            "description": "Indentation level in the list (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "position": {
            "description": "Insertion index; defaults to the end of the list",
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
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
            },
            "description": "Message lines (one entry per visual line)"
          },
          "faceName": {
            "description": "Face image basename (\"\" = none, default)",
            "type": "string"
          },
          "faceIndex": {
            "description": "Face index 0–7 in the sheet (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "background": {
            "description": "Window background (default window)",
            "type": "string",
            "enum": [
              "window",
              "dim",
              "transparent"
            ]
          },
          "position": {
            "description": "Window position (default bottom)",
            "type": "string",
            "enum": [
              "top",
              "middle",
              "bottom"
            ]
          },
          "speakerName": {
            "description": "MZ name-box speaker name (default \"\")",
            "type": "string"
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            },
            "description": "The choice labels shown to the player"
          },
          "branches": {
            "description": "Commands per choice (same order as choices); omitted/short = empty branches",
            "type": "array",
            "items": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "code": {
                    "type": "integer",
                    "minimum": -9007199254740991,
                    "maximum": 9007199254740991,
                    "description": "Event command code"
                  },
                  "indent": {
                    "description": "Indentation level (default 0)",
                    "type": "integer",
                    "minimum": -9007199254740991,
                    "maximum": 9007199254740991
                  },
                  "parameters": {
                    "description": "Command parameters (default [])",
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
            "description": "Commands for a \"When Cancel\" branch (adds a 403 block; cancel routes here)",
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "Event command code"
                },
                "indent": {
                  "description": "Indentation level (default 0)",
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991
                },
                "parameters": {
                  "description": "Command parameters (default [])",
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
            "description": "Without a cancelBranch: 0-based choice index the Cancel button maps to, or -1 Disallow (default -1)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "defaultType": {
            "description": "0-based default (highlighted) choice, or -1 none (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "position": {
            "description": "Choice window position (default right)",
            "type": "string",
            "enum": [
              "left",
              "middle",
              "right"
            ]
          },
          "background": {
            "description": "Choice window background (default window)",
            "type": "string",
            "enum": [
              "window",
              "dim",
              "transparent"
            ]
          },
          "indent": {
            "description": "Indentation level of the block (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
                ],
                "description": "Condition type"
              },
              "switchId": {
                "description": "switch: the switch id to test",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "name": {
                "description": "self_switch: which self switch",
                "type": "string",
                "enum": [
                  "A",
                  "B",
                  "C",
                  "D"
                ]
              },
              "value": {
                "description": "switch/self_switch: test for on (default) or off",
                "type": "string",
                "enum": [
                  "on",
                  "off"
                ]
              },
              "variableId": {
                "description": "variable: the variable id (left side)",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "comparison": {
                "description": "variable: comparison operator",
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
                "description": "variable: compare against this constant (default 0)",
                "type": "number"
              },
              "variableOperand": {
                "description": "variable: compare against this variable id (overrides constant)",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "actorId": {
                "description": "actor_in_party: the actor id",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "itemId": {
                "description": "item: the item id (tests \"party has item\")",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "gold": {
                "description": "gold: the amount to compare against",
                "type": "number"
              },
              "compare": {
                "description": "gold: comparison operator",
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
            ],
            "description": "Conditional branch condition"
          },
          "thenBranch": {
            "description": "Commands to run when the condition is true (default empty)",
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "Event command code"
                },
                "indent": {
                  "description": "Indentation level (default 0)",
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991
                },
                "parameters": {
                  "description": "Command parameters (default [])",
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
            "description": "Commands for the Else branch; presence (even empty) adds the 411 Else block",
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "Event command code"
                },
                "indent": {
                  "description": "Indentation level (default 0)",
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991
                },
                "parameters": {
                  "description": "Command parameters (default [])",
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
            "description": "Indentation level of the block (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            ],
            "description": "Which flow command to build"
          },
          "frames": {
            "description": "wait: number of frames (60 = 1 second)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "name": {
            "description": "label/jump_to_label: the label name",
            "type": "string"
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            ],
            "description": "\"switch\" (global, by id/range) or \"self_switch\" (this event, A–D)"
          },
          "switchId": {
            "description": "switch: the switch id (range start)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "endId": {
            "description": "switch: inclusive range end (default = switchId, a single switch)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "name": {
            "description": "self_switch: which self switch",
            "type": "string",
            "enum": [
              "A",
              "B",
              "C",
              "D"
            ]
          },
          "value": {
            "description": "Set on (default) or off",
            "type": "string",
            "enum": [
              "on",
              "off"
            ]
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "The target variable id (range start)"
          },
          "endId": {
            "description": "Inclusive range end (default = variableId, a single variable)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "operation": {
            "description": "Arithmetic applied to the target (default set)",
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
                ],
                "description": "Operand source for the variable value"
              },
              "value": {
                "description": "constant: the value",
                "type": "number"
              },
              "variableId": {
                "description": "variable: the source variable id",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "min": {
                "description": "random: inclusive minimum",
                "type": "number"
              },
              "max": {
                "description": "random: inclusive maximum",
                "type": "number"
              },
              "dataType": {
                "description": "game_data: 0 item/1 weapon/2 armor count, 3 actor, 4 enemy, 5 char, 6 party, 7 other, 8 last",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "param1": {
                "description": "game_data: first sub-parameter (see corescript)",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "param2": {
                "description": "game_data: second sub-parameter (see corescript)",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "type"
            ],
            "description": "The right-hand operand of the Control Variables command"
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            ],
            "description": "Gain or lose gold"
          },
          "operand": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "constant",
                  "variable"
                ],
                "description": "constant amount or a variable value"
              },
              "value": {
                "description": "constant: the amount",
                "type": "number"
              },
              "variableId": {
                "description": "variable: the variable id to read",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "type"
            ],
            "description": "The amount to gain/lose (constant or variable)"
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            ],
            "description": "Which inventory to change"
          },
          "id": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "The item/weapon/armor id"
          },
          "operation": {
            "type": "string",
            "enum": [
              "increase",
              "decrease"
            ],
            "description": "Gain or lose"
          },
          "operand": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "constant",
                  "variable"
                ],
                "description": "constant amount or a variable value"
              },
              "value": {
                "description": "constant: the amount",
                "type": "number"
              },
              "variableId": {
                "description": "variable: the variable id to read",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "type"
            ],
            "description": "The amount to gain/lose (constant or variable)"
          },
          "includeEquip": {
            "description": "weapon/armor: also count equipped copies (default false)",
            "type": "boolean"
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "The actor id"
          },
          "operation": {
            "type": "string",
            "enum": [
              "add",
              "remove"
            ],
            "description": "Add to or remove from the party"
          },
          "initialize": {
            "description": "add only: reset the actor to their initial state (default false)",
            "type": "boolean"
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Destination map id (or a variable id if designation=variable)"
          },
          "x": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Destination tile x (or a variable id)"
          },
          "y": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Destination tile y (or a variable id)"
          },
          "direction": {
            "description": "Facing after transfer (default retain)",
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
            "description": "Fade style (default black)",
            "type": "string",
            "enum": [
              "black",
              "white",
              "none"
            ]
          },
          "designation": {
            "description": "direct: mapId/x/y are literal; variable: they are variable ids (default direct)",
            "type": "string",
            "enum": [
              "direct",
              "variable"
            ]
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            ],
            "description": "Which audio channel to play on"
          },
          "name": {
            "type": "string",
            "description": "Audio basename (from list_assets, extension stripped)"
          },
          "volume": {
            "description": "Volume 0–100 (default 90)",
            "type": "number"
          },
          "pitch": {
            "description": "Pitch 50–150 (default 100)",
            "type": "number"
          },
          "pan": {
            "description": "Pan -100–100 (default 0)",
            "type": "number"
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            ],
            "description": "Which screen effect to build"
          },
          "color": {
            "description": "tint: [red,green,blue,gray] (−255…255); flash: [red,green,blue,intensity] (0…255)",
            "minItems": 4,
            "maxItems": 4,
            "type": "array",
            "items": {
              "type": "number"
            }
          },
          "power": {
            "description": "shake: strength 1–9 (default 5)",
            "type": "number"
          },
          "speed": {
            "description": "shake: speed 1–9 (default 5)",
            "type": "number"
          },
          "duration": {
            "description": "tint/flash/shake: frames (default 60)",
            "type": "number"
          },
          "wait": {
            "description": "tint/flash/shake: hold the event until it finishes (default true)",
            "type": "boolean"
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            ],
            "description": "Show a picture or erase a slot"
          },
          "pictureId": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Picture slot 1–100"
          },
          "name": {
            "description": "show: picture basename (from list_assets(\"pictures\"))",
            "type": "string"
          },
          "origin": {
            "description": "show: anchor point (default upper_left)",
            "type": "string",
            "enum": [
              "upper_left",
              "center"
            ]
          },
          "x": {
            "description": "show: screen x in pixels (default 0)",
            "type": "number"
          },
          "y": {
            "description": "show: screen y in pixels (default 0)",
            "type": "number"
          },
          "scaleX": {
            "description": "show: horizontal scale % (default 100)",
            "type": "number"
          },
          "scaleY": {
            "description": "show: vertical scale % (default 100)",
            "type": "number"
          },
          "opacity": {
            "description": "show: opacity 0–255 (default 255)",
            "type": "number"
          },
          "blend": {
            "description": "show: blend mode (default normal)",
            "type": "string",
            "enum": [
              "normal",
              "additive",
              "multiply",
              "screen"
            ]
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            ],
            "description": "Play an animation or a balloon icon"
          },
          "characterId": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Target character: -1 player, 0 this event, N event id on the current map"
          },
          "id": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "animation: the animation id; balloon: the balloon id (1 exclamation, 2 question, …)"
          },
          "wait": {
            "description": "Hold the event until it finishes (default false)",
            "type": "boolean"
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            ],
            "description": "How the troop is chosen (default direct)"
          },
          "troopId": {
            "description": "direct: the troop id; variable: the variable id holding it",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "canEscape": {
            "description": "Allow the party to escape (default false)",
            "type": "boolean"
          },
          "canLose": {
            "description": "Continue the event if the party loses (default false)",
            "type": "boolean"
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
                  ],
                  "description": "What is for sale"
                },
                "id": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "The item/weapon/armor id"
                },
                "price": {
                  "description": "Override price (omitted = the database standard price)",
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991
                }
              },
              "required": [
                "kind",
                "id"
              ]
            },
            "description": "The goods offered (at least one)"
          },
          "purchaseOnly": {
            "description": "Hide the sell tab (default false)",
            "type": "boolean"
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "The actor whose name is entered"
          },
          "maxLength": {
            "description": "Max name length (default 8)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            ],
            "description": "Which actor change to build"
          },
          "target": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "fixed",
                  "variable"
                ],
                "description": "fixed actor id (0 = whole party) or a variable"
              },
              "actorId": {
                "description": "fixed: the actor id (0 = entire party)",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "variableId": {
                "description": "variable: the variable id holding the actor id",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "type"
            ],
            "description": "Which actor(s) the change applies to"
          },
          "operation": {
            "description": "hp/mp/exp/level: gain or lose (default increase)",
            "type": "string",
            "enum": [
              "increase",
              "decrease"
            ]
          },
          "operand": {
            "description": "hp/mp/exp/level: the amount (constant/variable)",
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "constant",
                  "variable"
                ],
                "description": "constant amount or a variable value"
              },
              "value": {
                "description": "constant: the amount",
                "type": "number"
              },
              "variableId": {
                "description": "variable: the variable id to read",
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "type"
            ]
          },
          "allowKnockout": {
            "description": "hp: allow the change to reduce HP to 0/death (default false)",
            "type": "boolean"
          },
          "showLevelUp": {
            "description": "exp/level: show the level-up message (default false)",
            "type": "boolean"
          },
          "stateOperation": {
            "description": "state: add or remove the state",
            "type": "string",
            "enum": [
              "add",
              "remove"
            ]
          },
          "stateId": {
            "description": "state: the state id",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "indent": {
            "description": "Indentation level (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            "description": "Which command list to insert into (default map_event)",
            "type": "string",
            "enum": [
              "map_event",
              "common_event",
              "troop_page"
            ]
          },
          "mapId": {
            "description": "target \"map_event\": the map id",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "eventId": {
            "description": "target \"map_event\": the event id",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "commonEventId": {
            "description": "target \"common_event\": the common event id",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "troopId": {
            "description": "target \"troop_page\": the troop id",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "pageIndex": {
            "description": "target \"map_event\"/\"troop_page\": zero-based page index",
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "commands": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "Event command code"
                },
                "indent": {
                  "description": "Indentation level (default 0)",
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991
                },
                "parameters": {
                  "description": "Command parameters (default [])",
                  "type": "array",
                  "items": {}
                }
              },
              "required": [
                "code"
              ]
            },
            "description": "The event commands to insert (e.g. the `commands` from a build_* tool)"
          },
          "position": {
            "description": "Insertion index; defaults to the end of the list",
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
            "type": "boolean"
          },
          "verbose": {
            "description": "Echo the full written record instead of the default summary. Off by default: the response reports identity, counts and command-list shape, which is what you would assert on, and omits the parameters/conditions you would only re-read. Read the full record with the matching get_* tool.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "eventId": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the event"
          },
          "pageIndex": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Zero-based page index"
          },
          "characterName": {
            "description": "Sprite sheet basename (from list_assets(\"characters\")); \"\" = no sprite",
            "type": "string"
          },
          "characterIndex": {
            "description": "Sprite index 0–7 in the sheet",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "direction": {
            "description": "Facing direction of the sprite",
            "type": "string",
            "enum": [
              "down",
              "left",
              "right",
              "up"
            ]
          },
          "pattern": {
            "description": "Sprite animation frame 0–2 (1 = idle)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "tileId": {
            "description": "Use a tile as the graphic instead of a sprite (0 = none)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "trigger": {
            "description": "What starts the page",
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
            "description": "Stacking vs. the player: below/same/above characters (same = solid)",
            "type": "string",
            "enum": [
              "below",
              "same",
              "above"
            ]
          },
          "through": {
            "description": "Let the player/others pass through the event",
            "type": "boolean"
          },
          "walkAnime": {
            "description": "Animate the walk cycle while moving",
            "type": "boolean"
          },
          "stepAnime": {
            "description": "Animate in place while stopped",
            "type": "boolean"
          },
          "directionFix": {
            "description": "Lock the facing direction",
            "type": "boolean"
          },
          "moveType": {
            "description": "Autonomous movement (custom uses moveRoute)",
            "type": "string",
            "enum": [
              "fixed",
              "random",
              "approach",
              "custom"
            ]
          },
          "moveSpeed": {
            "description": "Movement speed 1–6 (4 = normal)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "moveFrequency": {
            "description": "Movement frequency 1–5 (3 = normal)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "moveRoute": {
            "description": "Autonomous move route (from create_move_route); pairs with moveType \"custom\"",
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "indent": {
            "description": "(unused; page-level tool)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
            "type": "boolean"
          },
          "verbose": {
            "description": "Echo the full written record instead of the default summary. Off by default: the response reports identity, counts and command-list shape, which is what you would assert on, and omits the parameters/conditions you would only re-read. Read the full record with the matching get_* tool.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map to place the NPC on"
          },
          "x": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "X tile position"
          },
          "y": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Y tile position"
          },
          "name": {
            "type": "string",
            "description": "Event name (editor label)"
          },
          "characterName": {
            "description": "Sprite sheet basename (from list_assets(\"characters\"))",
            "type": "string"
          },
          "characterIndex": {
            "description": "Sprite index 0–7 in the sheet",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "direction": {
            "description": "Facing direction (default down)",
            "type": "string",
            "enum": [
              "down",
              "left",
              "right",
              "up"
            ]
          },
          "pattern": {
            "description": "Sprite frame 0–2 (default 1 = idle when a sprite is set)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "text": {
            "description": "Dialogue lines shown when the NPC is triggered (built as Show Text)",
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "faceName": {
            "description": "text: face image basename (from list_assets(\"faces\"))",
            "type": "string"
          },
          "faceIndex": {
            "description": "text: face index 0–7",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "speakerName": {
            "description": "text: MZ name-box speaker name",
            "type": "string"
          },
          "commands": {
            "description": "Explicit command list (from the build_* tools); overrides `text` if given",
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "Event command code"
                },
                "indent": {
                  "description": "Indentation level (default 0)",
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991
                },
                "parameters": {
                  "description": "Command parameters (default [])",
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
            "description": "What starts the event (default action_button)",
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
            "description": "Stacking vs. the player (default same = solid)",
            "type": "string",
            "enum": [
              "below",
              "same",
              "above"
            ]
          },
          "through": {
            "description": "Let the player pass through (default false)",
            "type": "boolean"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map to place the chest on"
          },
          "x": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "X tile position"
          },
          "y": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Y tile position"
          },
          "kind": {
            "type": "string",
            "enum": [
              "item",
              "weapon",
              "armor",
              "gold"
            ],
            "description": "What the chest gives; item/weapon/armor require `id`"
          },
          "id": {
            "description": "The item/weapon/armor ID to give (omit for kind \"gold\")",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "amount": {
            "description": "How many (or how much gold) to give; default 1",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "name": {
            "description": "Event name (editor label); default \"Chest\"",
            "type": "string"
          },
          "characterName": {
            "description": "Chest sprite basename from list_assets(\"characters\"), e.g. \"!Chest\"",
            "type": "string"
          },
          "characterIndex": {
            "description": "Which chest in the sheet (0-7); default 0",
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "closedDirection": {
            "description": "Direction row showing the CLOSED chest; default \"down\"",
            "type": "string",
            "enum": [
              "down",
              "left",
              "right",
              "up"
            ]
          },
          "openedDirection": {
            "description": "Direction row showing the OPENED chest; default \"up\"",
            "type": "string",
            "enum": [
              "down",
              "left",
              "right",
              "up"
            ]
          },
          "text": {
            "description": "Optional message shown on opening, e.g. [\"Found a Potion!\"]",
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "selfSwitch": {
            "description": "Self switch channel marking the chest looted; default \"A\"",
            "type": "string",
            "enum": [
              "A",
              "B",
              "C",
              "D"
            ]
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map the trigger is placed on"
          },
          "x": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "X tile position of the trigger"
          },
          "y": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Y tile position of the trigger"
          },
          "targetMapId": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the destination map"
          },
          "targetX": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "X tile the player lands on"
          },
          "targetY": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Y tile the player lands on"
          },
          "idiom": {
            "description": "action_button = face a solid landmark and press (priority same, default); player_touch = walk onto a doormat (priority below)",
            "type": "string",
            "enum": [
              "action_button",
              "player_touch"
            ]
          },
          "name": {
            "description": "Event name (editor label); default \"Transfer\"",
            "type": "string"
          },
          "direction": {
            "description": "Facing after the transfer; default \"retain\"",
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
            "description": "Screen fade during the transfer; default \"black\"",
            "type": "string",
            "enum": [
              "black",
              "white",
              "none"
            ]
          },
          "characterName": {
            "description": "Optional sprite basename (a doormat is normally left invisible)",
            "type": "string"
          },
          "characterIndex": {
            "description": "Sprite index 0-7 in the sheet",
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
            "type": "boolean"
          },
          "force": {
            "description": "Write even if validation finds structural problems (wrong parameter count, unterminated command list). Off by default: such a write is refused and nothing is written. Advisory warnings never block regardless.",
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
            "description": "Optional: restrict to one plugin (its filename without .js)",
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
            "type": "string",
            "description": "Plugin filename without .js (event command parameters[0])"
          },
          "commandName": {
            "type": "string",
            "description": "The command key the plugin registered (event command parameters[1])"
          },
          "args": {
            "description": "Command arguments as { name: value }; values are stored as strings on disk",
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "label": {
            "description": "Editor display label (parameters[2]); defaults to the command key",
            "type": "string"
          },
          "indent": {
            "description": "Indentation level in the target list (default 0)",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
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
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "The raw tile id to decode"
          },
          "tilesetId": {
            "description": "Tileset id — when given, also report the tile transparency (needs-a-base) flag",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "Tileset id (from Tilesets.json / the map)"
          },
          "sheet": {
            "description": "Restrict to one sheet by filename ('World_A2') or role ('A2'). Omit to get a per-sheet summary (counts only) instead of every entry.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "Tileset id (from Tilesets.json / the map)"
          },
          "query": {
            "type": "string",
            "description": "Substring to match, e.g. 'grass' or 'forest' (literal substring, no synonyms)"
          },
          "searchDescriptions": {
            "description": "Also match project-catalog tile descriptions, not just names (default false — names only)",
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
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "tiles": {
            "minItems": 1,
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "x": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "X tile position"
                },
                "y": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991,
                  "description": "Y tile position"
                },
                "tileId": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991,
                  "description": "Tile id to paint (autotile base id from find_tile, or a raw id)"
                }
              },
              "required": [
                "x",
                "y",
                "tileId"
              ]
            },
            "description": "Cells to paint"
          },
          "layer": {
            "description": "Z-layer 0-5 (default 0 = lower ground; 0-3 tiles, 4 shadow, 5 region id)",
            "type": "integer",
            "minimum": 0,
            "maximum": 5
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "x": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Left tile position of the rectangle"
          },
          "y": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Top tile position of the rectangle"
          },
          "width": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "Rectangle width in tiles"
          },
          "height": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "Rectangle height in tiles"
          },
          "tileId": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Tile id to fill with (autotile base or raw)"
          },
          "layer": {
            "description": "Z-layer 0-5 (default 0 = lower ground; 5 = region id)",
            "type": "integer",
            "minimum": 0,
            "maximum": 5
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The tileset id the object belongs to"
          },
          "topLeftId": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Raw flat tile id of the object's top-left cell (from find_tile/get_tile_catalog)"
          },
          "width": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "Object width in tiles"
          },
          "height": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "Object height in tiles"
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "x": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Left (top-left) tile x of where the object is placed"
          },
          "y": {
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991,
            "description": "Top (top-left) tile y of where the object is placed"
          },
          "tiles": {
            "minItems": 1,
            "type": "array",
            "items": {
              "minItems": 1,
              "type": "array",
              "items": {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              }
            },
            "description": "The object as a rectangular grid of tile ids: rows top→bottom, each row left→right. 0 = a transparent cell (left untouched)."
          },
          "layer": {
            "description": "Z-layer 0-3 to stamp onto (default 2 = upper tile layer, drawn over the ground)",
            "type": "integer",
            "minimum": 0,
            "maximum": 3
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "Tileset id (from Tilesets.json / the map)"
          },
          "tileId": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "The raw tile id whose flags to decode"
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The map id to inspect"
          },
          "x": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Tile x coordinate"
          },
          "y": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Tile y coordinate"
          },
          "direction": {
            "description": "Optional: also report a single passable boolean for this direction",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "Tileset id (from Tilesets.json / the map)"
          },
          "tileId": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "The raw tile id whose flags to edit"
          },
          "passage": {
            "description": "Walkability per direction (true = walkable). Only the given directions change.",
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
            "description": "[*] overlay: tile drawn above the character.",
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
            "description": "Damage floor (standing on it hurts).",
            "type": "boolean"
          },
          "terrainTag": {
            "description": "Terrain tag 0–7 (0 = none).",
            "type": "integer",
            "minimum": 0,
            "maximum": 7
          },
          "applyToAutotileKind": {
            "description": "When the tile is an autotile (A1–A4), apply the change to all 48 shape slots of its kind (default true). Ignored for flat tiles.",
            "type": "boolean"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The 1-based variable ID"
          },
          "name": {
            "type": "string",
            "description": "The name to assign"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The 1-based switch ID"
          },
          "name": {
            "type": "string",
            "description": "The name to assign"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "The new game title"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "description": "Background image basename from list_assets(\"titles1\") (the far layer)",
            "type": "string"
          },
          "title2Name": {
            "description": "Background image basename from list_assets(\"titles2\") (drawn over title1Name)",
            "type": "string"
          },
          "titleBgm": {
            "description": "BGM that plays while the title screen is shown",
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "description": "Audio basename from list_assets(\"bgm\")"
              },
              "volume": {
                "description": "Volume 0–100 (default 90)",
                "type": "number"
              },
              "pitch": {
                "description": "Pitch 50–150 (default 100)",
                "type": "number"
              },
              "pan": {
                "description": "Pan -100–100 (default 0)",
                "type": "number"
              }
            },
            "required": [
              "name"
            ]
          },
          "drawTitle": {
            "description": "Whether to draw the game title text over the background art (the editor's \"Draw Game Title\" option)",
            "type": "boolean"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "Starting map ID"
          },
          "x": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Starting x tile"
          },
          "y": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Starting y tile"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
              "type": "integer",
              "exclusiveMinimum": 0,
              "maximum": 9007199254740991
            },
            "description": "Ordered actor ids for the starting party"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            ],
            "description": "Which term group to edit"
          },
          "key": {
            "type": "string",
            "description": "Index (for basic/commands/params) or message key (for messages)"
          },
          "value": {
            "type": "string",
            "description": "The new term text"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            ],
            "description": "Which type-name array to read"
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
            ],
            "description": "Which type-name array to edit"
          },
          "index": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "Index within the array (0 = empty slot)"
          },
          "name": {
            "type": "string",
            "description": "The new type name"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "type": "string",
            "description": "The currency unit string"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            ],
            "description": "Asset kind to list. Images: characters, faces, tilesets, pictures, parallaxes, battlebacks1, battlebacks2, enemies, sv_actors, sv_enemies, titles1, titles2, system. Audio: bgm, bgs, me, se."
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
            ],
            "description": "Which table to index: actors, classes, items, weapons, armors, skills, enemies, troops, states, common_events, tilesets, or maps."
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
            ],
            "description": "Which table to read: actors, classes, items, weapons, armors, skills, enemies, troops, states, or common_events."
          },
          "id": {
            "description": "Return just this record (null if missing); omitted = the whole table",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
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
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the map"
          },
          "eventId": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "The ID of the event to validate"
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
            ],
            "description": "Which id namespace: switch, variable, or common_event. Database rows (actors, items, …) are not here — create_*/batch_create assign those ids, and list_names shows what exists."
          },
          "id": {
            "description": "Report just this id — whether it is allocated, its label, and every place it is referenced. Omitted = the whole namespace.",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
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
            ],
            "description": "Which id namespace: switch, variable, or common_event. Database rows (actors, items, …) are not here — create_*/batch_create assign those ids, and list_names shows what exists."
          },
          "count": {
            "description": "How many consecutive free ids to return (default 1)",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 100
          },
          "reuseGaps": {
            "description": "Fill unallocated holes below the highest id first (default false)",
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
            ],
            "description": "Which database the records are appended to"
          },
          "records": {
            "minItems": 1,
            "type": "array",
            "items": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            },
            "description": "The records to create, each shaped like the matching create_* tool's arguments (e.g. for type \"actor\": { name, classId?, ... })"
          },
          "dryRun": {
            "description": "Preview only: return a diff of what would change without writing to disk.",
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
            "description": "Optional: restrict to one plugin (its filename without .js)",
            "type": "string"
          },
          "enabledOnly": {
            "description": "Only report plugins enabled in js/plugins.js (default false)",
            "type": "boolean"
          }
        }
      }
    }
  ]
}
