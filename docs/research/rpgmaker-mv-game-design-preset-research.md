# RPG Maker MV game-design preset research

**Scope.** Research only; no application files were changed. DSH was checked at the pinned `0.1.0-rc.8` release tag/commit [`141eb6f`](https://github.com/deepseek-ai/deepseek-harness/tree/141eb6fef83422698aef7a981029e843e8161534) and the repository state was checked locally.

## 1. DSH Web metadata: no verified avatar/icon/image field

**Decision:** do not add `avatar`, `icon`, `emoji`, or `image` to a preset spec. The pinned runtime's preset metadata schema supports only `name`, `description`, and `order`.

The exact metadata interface in rc.8 is [`packages/preset/agent-presets/src/metadata.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/preset/agent-presets/src/metadata.ts):

```yaml
# <preset-directory>/preset.yml
name: RPG Maker MV 游戏设计助手
description: 帮助完善游戏设计文档与机制。
order: 1
```

`order` is valid metadata, but it is a roster-sorting field rather than a visual identity field. The rc.8 reader extracts only those three keys and ignores other values; malformed or absent metadata falls back to the preset id. The Web API schema also exposes only `id`, `trust`, `isDefault`, `name`, `description`, and `broken` in [`agent-presets.schema.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/host/apiproxy/src/api/agent-presets.schema.ts).

The Web picker uses a fixed DSH preset glyph, not preset-supplied artwork: [`AgentPresetSeat.tsx`](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/client/ui-agent-preset/src/client/AgentPresetSeat.tsx) renders `IconAgentPresetOutline16` and option name/description. Thus DSH Web message/image support, if present elsewhere, is not evidence of preset-card image support.

This is **preset-level**, not profile-level. In DSH terminology a profile is the runnable composition under `$DSH_HOME/profiles/<name>`: its `package.json` carries `dsh.profile.bundles`, and its `cordis.patch.yml` is a configuration layer ([profile architecture](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/docs/architecture.md), [profile manifest](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/docs/user/develop/basic/publish.md)). The verified profile syntax is configuration composition, for example `{"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base"]}}}`; rc.8 has no verified Web display-avatar field in that profile manifest either. A profile and an Agent preset should not be conflated: the former assembles the Host/runtime; the latter is a directory containing `agent.cordis.yml` plus optional `preset.yml` display text.

## 2. `senior-game-designer-skill` assessment

Source inspected at commit [`89ee591`](https://github.com/tigermkiiiddd/senior-game-designer-skill/tree/89ee5915f34df9094f977626162a12c2e96cb85d); the repository has no `LICENSE` file and the GitHub repository API reports no declared license ([repository metadata](https://api.github.com/repos/tigermkiiiddd/senior-game-designer-skill)). Do not vendor or reproduce its Markdown wholesale without permission.

### Reusable capabilities

- A useful **constraint → breadth → depth → design** workflow, with explicit top-down consistency checks; this is described in [`SKILL.md`](https://github.com/tigermkiiiddd/senior-game-designer-skill/blob/89ee5915f34df9094f977626162a12c2e96cb85d/SKILL.md).
- Good prompts for clarifying the player experience, core loop, systems, resources, risks, player errors, validation criteria, and prototype plans.
- A document-oriented structure: concept/top-level/system documents, plus `constraint.md`, `breadth.md`, `depth.md`, and design/execution outputs. The repository supplies reusable templates under [`examples/`](https://github.com/tigermkiiiddd/senior-game-designer-skill/tree/89ee5915f34df9094f977626162a12c2e96cb85d/examples) and reference notes under [`references/`](https://github.com/tigermkiiiddd/senior-game-designer-skill/tree/89ee5915f34df9094f977626162a12c2e96cb85d/references).
- Its emphasis on challenging intuition rather than merely generating prose is a good fit for a design-doc refinement assistant.

### Constraints and product mismatches

- It explicitly prohibits code and technical-architecture discussion, while this product's existing RPG Maker assistant operates on project data, events, plugins, validation, backups, and Playtest boundaries ([`presets/rpgmaker/agent.cordis.yml`](../../presets/rpgmaker/agent.cordis.yml), [`presets/rpgmaker/skills/rpgmaker-mv/SKILL.md`](../../presets/rpgmaker/skills/rpgmaker-mv/SKILL.md)). A new design assistant should keep design critique separate from implementation claims and hand off implementation work.
- It mandates Mermaid diagrams, immediate Markdown output, and a large multi-phase document lifecycle. Those are useful defaults, but too rigid for a user asking to refine one mechanic or one existing document.
- It is broad across monetization, live-service categories, psychology, and many genres. Those sections should not become unsupported RPG Maker MV assumptions. Its neurochemical explanations and genre matrices are heuristics, not engine or player-research authority.
- Its references and templates are source material, not a license to copy. Reimplement the small workflow in the repository's voice and cite the upstream project if materially influenced.

There is no repository file or preset named `grill`/`grilling` (repository search found no match). The closest existing pattern is the evidence discipline in [`presets/playtest-debug/skills/playtest-debug/SKILL.md`](../../presets/playtest-debug/skills/playtest-debug/SKILL.md): bounded checks, refusal to guess, and explicit separation of evidence classes. Reuse that stance for design critique, but do not import the senior skill's rigid full-lifecycle output contract.

## 3. Minimal safe source set

| Source | What it is authoritative for | Access/licensing/citation | Proposed treatment |
|---|---|---|---|
| [Official MV Help: main features](https://rpgmakerofficial.com/product/MV_Help/page/01_01_01.html), especially [Maps](https://rpgmakerofficial.com/product/MV_Help/page/01_01_01_02.html), [Plugins](https://rpgmakerofficial.com/product/MV_Help/page/01_01_01_03.html), [Database](https://rpgmakerofficial.com/product/MV_Help/page/01_01_01_04.html), and [Events](https://rpgmakerofficial.com/product/MV_Help/page/01_01_01_06.html) | Product-level MV constraints: HTML5-oriented outputs, native map/database/event/plugin concepts, `816×624` default game resolution, and region/editor/plugin-command capabilities documented by KADOKAWA's product help | Public first-party documentation; cite the exact page and quote sparingly. Do not assume a feature is available merely because a third-party plugin supports it. | **Browsing source**; keep a small URL/index reference, not a copied manual. |
| [Official MV Plugin Specifications](https://rpgmakerofficial.com/product/MV_Help/page/01_11_03.html) and [Output Formats](https://rpgmakerofficial.com/product/MV_Help/page/01_11_04.html) | Plugin metadata/Note fields, plugin commands, and deployment/platform constraints | First-party product help; cite version-sensitive claims and distinguish core MV from a plugin or deployment wrapper. | **Browsing source**; no bulk embedding. |
| The current user's project files (`data/*.json`, `js/plugins.js`, plugin files, maps, and project metadata) | The actual project's IDs, records, plugin parameters, map/event structure, and installed constraints; the live project is more authoritative than a generic template | User-owned/local state; do not upload or reproduce it in a global skill. Existing tooling already treats the selected DSH Web workspace as the write target ([`presets/rpgmaker/skills/rpgmaker-mv/SKILL.md`](../../presets/rpgmaker/skills/rpgmaker-mv/SKILL.md)). | **Local reference**, read only for design refinement unless the user explicitly asks for an implementation handoff. |
| First-party documentation for a named reference game (publisher/developer manual, official site, patch notes); use a platform page such as [Steam](https://store.steampowered.com/) only for store-level facts | Observable mechanics, rules, terminology, and stated player promises for the particular game being compared | Access may change; copyright remains with the publisher. Cite title, page URL, and access date. Do not scrape or embed a general game encyclopedia. | **Browsing source**, selected per user/game; not a fixed embedded corpus. |
| [MDA: A Formal Approach to Game Design and Game Research](https://users.cs.northwestern.edu/~hunicke/MDA.pdf) | A compact vocabulary for mechanics, dynamics, and aesthetics when refining a loop | Public scholarly PDF; its page does not grant a repository redistribution license. Cite it and paraphrase; do not copy it into a skill. | **Browsing source** or a short locally authored citation note. |
| Community wikis, forums, videos, and generic “game design” posts | Leads and player-facing examples, not authoritative engine constraints or proof of a mechanic | Rights, accuracy, version, and persistence vary. They require attribution and cross-checking. | **Browse only**, never silently embed or present as first-party truth. |

The assistant should ask which game/genre is the reference before collecting examples. A minimal answer can use one or two named games, one official source per game, and the MV Help pages above; it should not preload a large copyrighted corpus.

## 4. User-provided archive

The archive was **not available** at `/Users/neil/Code/wagaya/wagaya-meowa-game-design-archive` or the plausible mounted equivalents checked under `/mnt/c/Users/...`, `/home/neil/Code/...`, `/home/neil/code/...`, and `/workspace/...`. No document structure or recurring sections can therefore be verified, and no archive content was copied.

## 5. Preset implications and open decisions

### Current exact roster

The repository currently ships four ids, in this order: `rpgmaker` / RPG Maker MV 开发助手 (`order: 0`), `playtest-debug` / 游戏测试与调试助手 (`order: 1`), `asset-workshop` / 游戏图片素材助手 (`order: 2`), and `build-release` / 游戏构建与发布助手 (`order: 3`). Their metadata is in [`presets/*/preset.yml`](../../presets/), their compositions are in [`presets/*/agent.cordis.yml`](../../presets/), and the id roster is hard-coded in [`src/rpgmaker.ts`](../../src/rpgmaker.ts) (`CUSTOM_AGENT_PRESET_IDS`, installation, validation, and default selection). The CLI and README also enumerate the four ids ([`src/cli.ts`](../../src/cli.ts), [`README.md`](../../README.md)).

### Exact implications

- **No avatar implementation is implied.** A new `preset.yml` may safely use only `name`, `description`, and, if ordering is wanted, `order`; an icon/image request is a DSH feature request, not a YAML edit.
- If the new assistant is **additive**, the likely new id needs a directory such as `presets/game-design/`, a metadata file, an Agent composition, and a design skill/reference directory. `CUSTOM_AGENT_PRESET_IDS`, preset installation/validation, CLI help, README roster text, and the preset-boundary tests must all be updated; the order number and whether it becomes the default are product decisions.
- If it is intended to **replace or rename `rpgmaker`**, that changes the default id and the documented `--preset` contract, source constants, installed paths, and tests. Decide whether the public id is stable (`rpgmaker`) while only the display name/scope changes, or whether an intentional breaking id rename is acceptable.
- **`playtest-debug` was not explicitly renamed. Preserve its id and current name/role by default.** Renaming it would be an independent product decision and would affect its documented launcher usage, tests, source constant, and handoff language; nothing in the supplied request authorizes that rename ([`presets/playtest-debug/preset.yml`](../../presets/playtest-debug/preset.yml), [`README.md`](../../README.md)).
- Decide whether game design is a separate, read-oriented assistant or a mode added to `rpgmaker`. A separate preset avoids mixing design critique with the existing mutation contract; a shared preset is cheaper but makes its role, tool access, and handoff boundary ambiguous.
- Decide whether the new assistant may browse external sources, whether citations are required in generated design docs, whether the user must approve named reference games, and whether it can read the current MV project at all. The safest default is browse-on-demand plus local project inspection, with no automatic writes and no embedded third-party corpus.
