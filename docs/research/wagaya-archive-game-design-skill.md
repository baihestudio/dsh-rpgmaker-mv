# Wagaya archive: game-design Skill research

**Decision date:** 2026-08-28
**Scope:** A local, user-provided primary source archive at
`/Users/neil/Code/wagaya/wagaya-meowa-game-design-archive`; this note extracts
workflows and document shapes, not the archive's game-specific creative content.

## Recommendation

Keep one `game-design` Skill. Give it two explicit phases—**game grilling** and
**living-document maintenance**—with a non-negotiable hand-off between them:
the interview produces only confirmed decisions, assumptions, and open questions;
the maintenance phase records those outcomes in the relevant canonical design
document and its paired decision analysis. Do not split this into independent
`game-grilling` and `doc-maintenance` Skills now.

The archive uses the two capabilities as one closed loop, rather than as two
independent jobs: a focused analysis records status and reasoning, then its
conclusion becomes (or deliberately does not become) a stable design rule. A
separate generic document-maintenance Skill would make it easier to update prose
without preserving that decision provenance, while a grilling-only Skill could
finish without maintaining the project knowledge base. Split later only if a
separate agent must maintain non-game documentation; it should not own game-design
decisions.

## Observed information architecture

The archive is a five-layer, linked design tree, not a monolithic GDD:

| Layer | Archive evidence | Reusable pattern |
| --- | --- | --- |
| Concept | [`01-概念设计.md`](file:///Users/neil/Code/wagaya/wagaya-meowa-game-design-archive/01-%E6%A6%82%E5%BF%B5%E8%AE%BE%E8%AE%A1.md) lines 5–50 | Keep one-sentence concept, design anchors, player/context, tensions, constraints, and non-goals distinct. |
| Top-level design | [`02-01-顶层设计.md`](file:///Users/neil/Code/wagaya/wagaya-meowa-game-design-archive/02-01-%E9%A1%B6%E5%B1%82%E8%AE%BE%E8%AE%A1.md) lines 3–84 | Record goal, driving force, large/small loops, minimum experience unit, pace, feedback, scope, and open questions before individual systems. |
| System design | [`03-01-系统架构.md`](file:///Users/neil/Code/wagaya/wagaya-meowa-game-design-archive/03-01-%E7%B3%BB%E7%BB%9F%E6%9E%B6%E6%9E%84.md) lines 3–67 | Name player-visible responsibilities, input/output/state flow, dependencies, boundaries, and the smallest vertical slice. It deliberately avoids premature implementation choices (lines 3–5, 54–64). |
| Core-mechanic spec | [`04-01-共同听歌核心玩法.md`](file:///Users/neil/Code/wagaya/wagaya-meowa-game-design-archive/04-01-%E5%85%B1%E5%90%8C%E5%90%AC%E6%AD%8C%E6%A0%B8%E5%BF%83%E7%8E%A9%E6%B3%95.md) lines 3–92 | For a mechanic, specify purpose, player experience, entry/exit, actions, choices, rules/states, feedback, loop, inputs/outputs/dependencies, non-goals, and prototype questions. |
| Research/reference reports | `05-01` through `05-06` | Keep source inspection separate from product decisions. The reports visibly separate facts from inference—for example [`05-02`](file:///Users/neil/Code/wagaya/wagaya-meowa-game-design-archive/05-02-%E5%8F%82%E8%80%83%E8%B5%84%E6%96%99-QQ%E5%B0%8F%E7%AA%9D%E6%A0%B8%E5%BF%83%E7%8E%A9%E6%B3%95%E3%80%81%E4%BD%93%E9%AA%8C%E4%B8%8E%E5%83%8F%E7%B4%A0%E7%A4%BE%E4%BA%A4%E6%B8%B8%E6%88%8F%E5%80%9F%E9%89%B4%E5%88%86%E6%9E%90.md) lines 19–29 and [`05-03`](file:///Users/neil/Code/wagaya/wagaya-meowa-game-design-archive/05-03-%E5%8F%82%E8%80%83%E8%B5%84%E6%96%99-LimeZu%20Modern%20Interiors%20%E7%B4%A0%E6%9D%90%E5%8C%85%E6%A0%B8%E6%9F%A5%E6%8A%A5%E5%91%8A.md) lines 30–39. |

Each canonical design layer has a narrow paired `*-分析.md` file. These are a
decision ledger, not meeting minutes: their repeated preamble says to retain only
important cross-round questions and that an agent proposal is not user confirmation
([`02-02-顶层设计-分析.md`](file:///Users/neil/Code/wagaya/wagaya-meowa-game-design-archive/02-02-%E9%A1%B6%E5%B1%82%E8%AE%BE%E8%AE%A1-%E5%88%86%E6%9E%90.md)
line 3; [`04-02-共同听歌核心玩法-分析.md`](file:///Users/neil/Code/wagaya/wagaya-meowa-game-design-archive/04-02-%E5%85%B1%E5%90%8C%E5%90%AC%E6%AD%8C%E6%A0%B8%E5%BF%83%E7%8E%A9%E6%B3%95-%E5%88%86%E6%9E%90.md)
lines 1–3). Each entry has a status, breadth analysis, depth analysis, and
integrated conclusion (for example `user_confirmed` at `04-02` lines 5–19 and
an explicit `agent_proposal` at lines 117–131).

## Concrete, license-safe additions to the Skill

These are locally authored workflow instructions inferred from the archive; they
do not copy its prose, game content, or third-party reference material.

1. **Use a canonical document plus paired decision ledger.** For a material
   unresolved question, append a compact entry containing: status
   (`confirmed`, `proposal`, or `open`), the question, options/trade-offs,
   evidence/assumptions, and conclusion. Update the canonical design doc only
   after the status is confirmed. This preserves the archive's confirmed-vs-
   proposed boundary without retaining chat transcripts.
2. **Choose the document depth by design scope.** A request that changes fantasy,
   player promise, constraints, or non-goals belongs in concept; one that changes
   loops/progression/scope belongs in top-level design; a player-visible system
   needs state/dependencies/boundaries; a single mechanic gets a compact
   interaction spec. Do not force every request through all layers.
3. **Make vertical-slice validation explicit.** For new systems, identify the
   smallest end-to-end player experience that tests the premise, its deferred
   features, and its still-open questions. The archive does this at
   `02-01-顶层设计.md` lines 38–40 and 82–84 and at
   `03-01-系统架构.md` lines 65–67.
4. **Separate player-facing design from technical commitment.** Capture feasibility
   constraints, but mark unvalidated implementation facts as open rather than
   inventing an architecture. This is demonstrated by the system boundary at
   `03-01-系统架构.md` lines 54–56 and the prototype/production distinction at
   `02-02-顶层设计-分析.md` lines 21–35.
5. **Require an explicit “avoid” check for reference games.** Translate a named
   reference into both transferable principle and context-specific risk. The
   archive's small-scope examples consistently reject checklist labor, FOMO,
   punitive daily chores, random-repeat acquisition, and content quantity that
   displaces meaningful combinations ([`05-04`](file:///Users/neil/Code/wagaya/wagaya-meowa-game-design-archive/05-04-%E5%8F%82%E8%80%83%E8%B5%84%E6%96%99-Wagaya%20%E9%A1%B6%E5%B1%82%E8%AE%BE%E8%AE%A1%E5%88%86%E6%9E%90%EF%BC%9A%E7%A4%BE%E5%8C%BA%E4%B8%AD%E5%BF%83%E7%BB%93%E6%9E%84%E7%9A%84%E8%BD%BB%E9%87%8F%E5%8C%96%E6%94%B9%E9%80%A0%E4%B8%8E%E9%A3%8E%E9%99%A9%E8%A7%84%E9%81%BF.md)
   lines 16–58; [`05-05`](file:///Users/neil/Code/wagaya/wagaya-meowa-game-design-archive/05-05-%E5%8F%82%E8%80%83%E8%B5%84%E6%96%99-%E9%9B%86%E5%90%88%E5%95%A6%EF%BC%81%E5%8A%A8%E7%89%A9%E6%A3%AE%E5%8F%8B%E4%BC%9A%E6%A0%B8%E5%BF%83%E6%9C%BA%E5%88%B6%E5%89%96%E6%9E%90%E4%B8%8E%20Wagaya%20%E6%B8%B8%E6%88%8F%E8%AE%BE%E8%AE%A1%E7%9A%84%E5%80%9F%E9%89%B4%E5%90%AF%E7%A4%BA.md)
   lines 35–47). These are design-review prompts, not universal rules.
6. **Preserve evidence labels in research notes.** Distinguish source-verified
   observations, design inference, agent proposal, and user-confirmed decision;
   cite the source URL/access date when external material matters. This strengthens
   the current Skill's citation rule rather than adding a copied reference corpus.

## Proposed one-Skill operating contract

1. Inspect the workspace index, existing canonical document, its paired analysis,
   and relevant code only for constraint verification.
2. Build the private decision tree. Use `ask_user_question` for only material,
   low-confidence product choices; record a concise `open` entry when the user has
   not answered rather than making it sound settled.
3. After answers, write/update the analysis entry with the evidence label,
   alternatives, and conclusion; promote only `confirmed` outcomes to the
   canonical document.
4. For new mechanics, apply the existing player goal/core loop/MDA checks plus
   the archive-derived mechanic checklist and one smallest validation slice.
5. Update links/index; report changed documents, decisions, open questions,
   assumptions, and consulted references. Do not write game code.

This is more precise than two Skills while keeping a future split inexpensive:
the headings are stable, but both phases remain one invocation contract.

## Source quality and limitations

The archive is primary evidence for its own document workflow and product decisions.
It is **not** authority for the claimed facts about reference games, assets, or
technical libraries: some of its listed sources are indirect redirect URLs and
several reports contain explicit inference. The DSH Skill should therefore keep its
existing policy of using official developer/publisher documentation for external
facts, paraphrasing sources, and never copying third-party material into project
documents.
