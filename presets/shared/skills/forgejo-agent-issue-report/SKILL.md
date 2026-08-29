---
name: forgejo-agent-issue-report
description: Report an agent-observed, verified DSH product defect, release blocker, or unsafe tool/MCP behavior to the dsh-rpgmaker-mv Forgejo tracker; collect technical evidence and deduplicate before filing.
---

# Forgejo agent incident reporting

Use this skill when direct task work reveals a problem in RPG Maker Agent itself: a defect, safety or privacy flaw, release/workflow blocker, or malfunctioning agent tool or MCP integration. User-reported experience and capability feedback follows `forgejo-user-feedback-report` instead.

## Qualification

Establish the incident from direct task evidence before filing. Prefer the smallest appropriate repair or verification first, except where preserving evidence or escalating a safety/release risk takes priority. A local credential, unavailable external service, invalid task input, or ordinary work in the selected workspace is not a product incident.

## Incident record

1. Capture non-secret triggering conditions, minimal reproduction, expected and actual behavior, impact, and the exact validation or error outcome.
2. Replace local absolute paths, credentials, private URLs, personal data, and raw environment values with safe descriptions.
3. Prepare a precise title and a Markdown body with `## 现象`, `## 复现步骤`, `## 期望行为`, `## 实际行为`, `## 影响`, and `## 证据`.

## File the incident

Read `../forgejo-issue-reporting-protocol.md`, then follow its deduplication and creation loop. Mention the created or existing issue briefly in the final task summary; filing an issue does not replace completing the requested work.
