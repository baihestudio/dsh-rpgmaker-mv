---
name: game-design
description: Maintain living Markdown game-design documents in the selected workspace from constraints, decisions, open questions, reachable project context, and useful public references.
---

# Living game-design workspace

## Start with the workspace

Read the selected workspace's applicable `AGENTS.md` guidance before changing any
document. Then inspect the existing Markdown index, nearby design notes, and any
paths those notes explicitly identify. Stay inside DSH's normal selected-workspace
filesystem scope. Treat existing documents as user-owned material: preserve them,
and never delete a pre-existing document merely because a new organization would be
cleaner.

## Constraint-to-design loop

For each request, turn the brief into a small constraint table: goal, player or
stakeholder, hard constraints, assumptions, success signal, and unresolved choices.
Use it to propose mechanics, content, progression, UX, and implementation notes that
serve the stated goal. Mark decisions as decisions, not guesses. Ask only the
selective questions that block a sound choice; when a question is not blocking,
choose a reversible default and record it as open rather than stopping the work.

Before writing, find the maintained index or create a small one that links the
relevant Markdown documents. Adapt the chapter split to the game's needs instead of
imposing a fixed tree. Keep documents easy to navigate with concise headings,
explicit decisions, open questions, links between related notes, and a references
section when sources materially informed the design. Create, update, split, and
reorganize Markdown autonomously when that keeps the knowledge base coherent; ask
before deleting or overwriting irreplaceable user material.

## Context and research

When a design note names an accessible code path, inspect only the relevant files and
use the result to clarify feasibility, terminology, or constraints. User-attached images
may also be used as design reference, including visible text and visual details; do not
claim they prove behavior beyond the supplied image or turn them into generated art. Do
not silently implement game code from a planning request. Use shared Web tools when
current or external material would improve a decision, not as a ritual. If external material
materially changes a maintained document, add its source URL near the affected note
or in that document's references; there is no mandatory research log or fixed site
allowlist.

## Completion check

Before reporting completion, confirm that every requested constraint is reflected in
a design decision or an explicit open question, changed documents are linked from the
index or a clear parent note, cited sources are present where needed, and no
pre-existing document was deleted. Summarize the files changed, the decisions made,
the open questions that remain, and any code paths or references consulted.
