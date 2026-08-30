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

If the workspace has no maintained game-design index or canonical design note, read
and follow the `game-design-bootstrap` Skill before this Skill's interview. Its
discovery pass establishes an evidence-labelled starting point; continue here for
the decision interview and ongoing maintenance.

## Design interview, then constraint-to-design loop

Before writing a design document, build the decision tree privately. Investigate
workspace facts yourself, then score every unresolved design decision. Ask only a
question that is both below 70% confidence and material to player experience,
product scope, workflow, or an irreversible preference. Ask at most five questions
in a round and include the decision, the meaningful options, and a recommendation.
For every qualifying question, call DSH's built-in `ask_user_question` tool instead
of asking in ordinary chat; group a round of related questions in that tool when its
input supports it. This keeps the interview visible and makes it easy for the user
to answer. Do not call it for workspace facts you can inspect yourself.
Never ask about technical implementation, routine verification, or a reversible
default: choose the simplest suitable default and record it as an open assumption.

Do not create or update design documents until the qualifying questions have answers,
or there are no qualifying questions. Then turn the confirmed brief into a small
constraint table: goal, player or stakeholder, hard constraints, assumptions,
success signal, decisions, and unresolved choices. Use it to propose mechanics,
content, progression, UX, and implementation notes that serve the stated goal. Mark
decisions as decisions, not guesses.

For a material unresolved decision, record a concise decision-ledger entry beside
the affected canonical design note: `confirmed`, `proposal`, or `open`; the
question; options and trade-offs; evidence or assumptions; and conclusion. Promote
only confirmed outcomes into the canonical design rule. A small request needs only
the relevant note and ledger entry, not a complete GDD.

Before writing, find the maintained index or create a small one that links the
relevant Markdown documents. Adapt the chapter split to the game's needs instead of
imposing a fixed tree. Keep documents easy to navigate with concise headings,
explicit decisions, open questions, links between related notes, and a references
section when sources materially informed the design. Create, update, split, and
reorganize Markdown autonomously when that keeps the knowledge base coherent; ask
before deleting or overwriting irreplaceable user material.

Route changes by their design scope. A player promise, fantasy, constraint, or
non-goal belongs in a concept note; a loop, progression, or scope change belongs in
top-level design; a player-visible system needs responsibilities, state or
information flow, dependencies, boundaries, and its smallest end-to-end validation
slice; a single mechanic needs purpose, experience, entry and exit, player actions,
choices, rules, feedback, and non-goals. Use only the depth the request warrants.

## Design lens and references

Use a player-first design lens: state the player goal and core loop; test whether
mechanics create the intended dynamics and aesthetic experience (the MDA lens);
then check meaningful choices and trade-offs, feedback and readability, progression
and pacing, accessibility, and feasibility against confirmed constraints. Do not
present a familiar pattern as a universal rule—record the desired player experience
and the evidence or assumption behind each material choice.

For the design vocabulary, use [MDA: A Formal Approach to Game Design and Game Research](https://users.cs.northwestern.edu/~hunicke/MDA.pdf) and paraphrase it. For a named reference game, prefer its publisher/developer site, manual, or patch notes; use [Steam](https://store.steampowered.com/) only for store-level facts. Treat wikis, forums, videos, and generic design posts as leads to cross-check, not authority. Cite a URL and access date wherever an external source materially changes a maintained design note; never copy a third-party corpus into the workspace.

For every named reference, record both the transferable principle and the project-
specific risk or reason not to adopt it. Label external observations as `source-
verified` and design conclusions as `inference`; user confirmation is distinct from
an agent proposal.

## Context and research

When a design note names an accessible code path, inspect only the relevant files and
use the result to clarify feasibility, terminology, or constraints. Do not diagnose
bugs, prescribe source-level fixes, or write implementation skeletons. Record the
confirmed design constraints and acceptance criteria for implementation work. User-attached images
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
pre-existing document was deleted. For a new system, also identify its smallest
validation slice, deferred features, and remaining open questions. Summarize the
files changed, the decisions made, the open questions that remain, and any code paths
or references consulted.
