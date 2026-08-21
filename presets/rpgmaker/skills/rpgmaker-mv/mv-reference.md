# RPG Maker MV runtime reference

This is a compact working reference for plugin changes. The target project's shipped
runtime and data files are authoritative; use this page to choose what to inspect,
not as a substitute for reading the actual project.

## Files and runtime layers

- `js/rpg_core.js` provides browser/NW.js foundations such as `Utils`, `Graphics`,
  `Input`, `TouchInput`, `JsonEx`, `Bitmap`, `Sprite`, and rendering/input helpers.
  It does not define the `*Manager` services or concrete `Scene_*`/`Window_*`
  classes; confirm names, signatures, and load order in the project's
  `js/rpg_*.js` files.
- Concrete `Scene_*` classes live in `rpg_scenes.js`, `Sprite_*` classes live in
  `rpg_sprites.js`, and `Window_*` classes live in `rpg_windows.js`. `SceneManager`
  in `rpg_managers.js` coordinates their lifecycle.
- `DataManager` in `rpg_managers.js` loads and saves project data, exposes the
  `$data*` globals, and controls database/new-game/save-file state. Treat its
  callbacks and success flags as runtime contracts, not assumptions from another
  MV version.
- The database globals are arrays or records loaded from `data/`: `$dataActors`,
  `$dataClasses`, `$dataSkills`, `$dataItems`, `$dataWeapons`, `$dataArmors`,
  `$dataEnemies`, `$dataTroops`, `$dataStates`, `$dataAnimations`, `$dataTilesets`,
  `$dataCommonEvents`, `$dataSystem`, and `$dataMap`/`$dataMapInfos` while a map is
  loaded. Entries normally use the editor's numeric ids; index `0` is commonly a
  placeholder. Read the current JSON before changing assumptions about optional
  fields, note/tag text, or array shape.
- `Game_*` objects in `rpg_objects.js` hold mutable game state: `Game_Temp`,
  `Game_System`, `Game_Switches`, `Game_Variables`, `Game_SelfSwitches`,
  `Game_Screen`, `Game_Timer`, `Game_Message`, `Game_Interpreter`, `Game_Map`,
  `Game_Player`, `Game_Event`, `Game_CharacterBase`/`Game_Character`,
  `Game_Party`/`Game_Troop`/`Game_Actor`/`Game_Enemy`, and battle actors/actions.
  `Game_Interpreter` executes event command lists and plugin commands; preserve
  its interpreter context and wait/update behavior when extending it.
- Managers in `rpg_managers.js` coordinate services and scenes: `DataManager`,
  `ConfigManager`, `StorageManager`, `ImageManager`, `AudioManager`,
  `SoundManager`, `TextManager`, `BattleManager`, `SceneManager`, and
  `PluginManager`. UI classes in `rpg_windows.js` and `rpg_scenes.js` consume
  the game objects; follow an existing MV class's lifecycle instead of inventing
  a second update or scene loop.
- `rpg_sprites.js` and `rpg_windows.js` are presentation layers. Keep plugin
  state in the appropriate `Game_*` or manager layer and make UI changes through
  the existing scene/window lifecycle. Plugin parameters and command registration
  belong to `PluginManager`/the plugin's current MV conventions.

## Plugin change gate

1. Read the target project's relevant `js/rpg_*.js` files and current `data/*.json`
   before editing. If a plugin already wraps or aliases a method, inspect that
   exact runtime and load order first.
2. Write ES5-compatible JavaScript: use `var`, functions, and MV-compatible
   patterns. Do not assume modern module syntax, bundler transforms, or APIs from
   RPG Maker MZ.
3. Use `fs` rather than `node:fs` only in an MV/NW.js runtime that actually
   provides the Node-compatible module; browser-only code must not assume Node.
4. Make the smallest necessary change. Avoid speculative compatibility adapters,
   broad refactors, and extra interfaces. Verify in the actual MV/NW.js runtime
   and report what was checked.
5. Use the RPG Maker Skill's read → one targeted mutation → reread → validation
   loop for project data. A reviewer, sub-agent, or second-model workflow is not
   part of this preset.

## Official references

- [RPG Maker MV Help](https://rpgmakerofficial.com/product/MV_Help/en/)
- [Plugin Specifications](https://rpgmakerofficial.com/product/MV_Help/page/01_11_03.html)
- [Output Formats](https://rpgmakerofficial.com/product/MV_Help/page/01_11_04.html)

Use the official pages for the supported plugin contract and deployment formats,
while using the installed project's runtime files for the exact API available to
the current game.
