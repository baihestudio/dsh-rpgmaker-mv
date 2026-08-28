---
name: game-design-bootstrap
description: Bootstrap a game-design workspace when the selected project has no maintained design index or canonical design note: discover the existing game, clarify material unknowns, and establish a small evidence-labelled design foundation.
---

# Bootstrap a game-design workspace

Use this Skill only when the selected workspace lacks maintained game-design
documentation. Read applicable `AGENTS.md` guidance first. This is a discovery and
foundation pass, not a license to redesign or implement the game.

## Discover before naming the game

Inspect the smallest relevant set of existing material to learn what is already true:
README and product metadata; the entry point and user-visible content; existing
data, scenes, levels, or assets; and any accessible configuration that constrains
platform, controls, or scope. Start from obvious project entry points and follow
references; do not sweep generated dependencies, build output, or unrelated files.
Separate direct observations from inference. Never turn absent documentation into a
claim that a feature does not exist.

## Establish the foundation

Build a private decision tree from the discovery. Use `ask_user_question` only for
unresolved choices that are below 70% confidence and materially affect player
experience, scope, workflow, or an irreversible preference; ask at most five per
round, with options and a recommendation. Do not ask for facts the workspace can
reveal.

After qualifying questions have answers, or none exist, create the smallest useful
design home in the workspace's established documentation location. If none exists,
create a concise `docs/game-design/` index. Link only the notes the project needs:
a foundation note for the observed player promise, target player/context,
constraints, non-goals, known core loop, assumptions, and open questions; plus a
paired decision ledger when there are material decisions. Mark every entry as
`source-verified`, `inference`, `proposal`, `confirmed`, or `open` as appropriate.
Do not invent missing mechanics merely to fill a template.

Finish when the index links every new note, observed facts remain distinguishable
from assumptions, unresolved material choices have either been asked through the
tool or recorded as open, and the game-design Skill has a clear canonical starting
point. Do not write game code during this foundation pass.
