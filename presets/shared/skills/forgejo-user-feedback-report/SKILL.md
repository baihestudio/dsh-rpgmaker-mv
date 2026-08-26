---
name: forgejo-user-feedback-report
description: Turn a user's DSH product complaint, workflow friction, capability request, or experience feedback into a clear, deduplicated Forgejo issue: ask only decision-changing questions, record the desired outcome and impact, then file without requiring technical reproduction.
---

# Forgejo user feedback reporting

Use this skill when a user describes friction, confusion, a missing capability, or an unsatisfactory experience in DSH RPGMaker MV itself. Treat their account as product feedback, not as an incident that needs the agent to reproduce.

## Feedback interview

1. Reflect the understood problem in one short sentence, then build the open product decisions internally.
2. Discover technical facts yourself. Ask only low-confidence questions whose answers materially change the user-facing outcome, scope, or priority; ask at most five per round. Prefer questions about the user's context, goal, current experience, desired experience, impact, and boundaries over implementation choices.
3. After each answer, update the shared understanding. Stop when the issue can accurately record the user scenario and goal, current experience or gap, desired outcome, impact or priority, and relevant boundaries.
4. If the user declines reporting, continue the requested task without filing. If the feedback is about ordinary workspace content rather than DSH itself, address it in the task instead of the product tracker.

Technical reproduction is optional here. Once the feedback is clear enough to be actionable, do not ask a separate permission question: the user has already authorized product-feedback reporting.

## Feedback record

Prepare a precise title and a Markdown body with `## 用户场景和目标`, `## 当前体验`, `## 期望体验`, `## 影响与优先级`, and `## 已澄清范围`. Preserve the user's intent rather than inventing a technical diagnosis. Replace credentials, local absolute paths, private URLs, personal data, and raw environment values with safe descriptions.

## File the feedback

Read `../forgejo-issue-reporting-protocol.md`, then follow its deduplication and creation loop. Briefly mention the created or matching issue in the final task summary.
