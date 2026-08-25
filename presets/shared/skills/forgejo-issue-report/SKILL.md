---
name: forgejo-issue-report
description: Report a verified DSH product defect, safety flaw, release blocker, or capability gap discovered while completing a task to the dsh-rpgmaker-mv Forgejo tracker. Deduplicate it and create an evidence-backed issue without asking again when reporting is warranted.
---

# Forgejo issue reporting

Use this skill after direct task evidence establishes a problem in DSH RPGMaker MV itself. The user has authorized automatic reporting to the product tracker.

## Report threshold

Create an issue only for a **verified** and actionable product problem, such as:

- reproducible behavior that contradicts a documented or tested DSH contract;
- a defect, data-loss risk, security/privacy exposure, or unsafe agent/tool behavior;
- a release or workflow blocker that remains after the task's smallest appropriate repair or verification; or
- a missing product capability that prevents the requested DSH workflow and has a concrete user impact.

Do not report an unverified hypothesis, an expected validation error from bad input, a missing local credential or external service, ordinary task work in the selected workspace, a style preference, or a problem the user explicitly declines to report.

## Tight reporting loop

1. Collect non-secret evidence: triggering conditions, minimal reproduction, expected and actual behavior, impact, and the exact validation or error outcome. Replace local absolute paths, credentials, private URLs, personal data, and raw environment values with safe descriptions.
2. Call `mcp__forgejo__list_repo_issues` with `owner: "baihestudio"`, `repo: "dsh-rpgmaker-mv"`, `state: "all"`, `page: 1`, and `limit: 50`; compare each returned title and evidence with the candidate. When a page is full, continue with the next page until one is shorter than the requested limit. If a matching issue exists, do not create another; cite it in the final task summary. If enumeration is ambiguous, do not create a speculative duplicate.
3. If no duplicate exists, call `mcp__forgejo__create_issue` with `owner: "baihestudio"`, `repo: "dsh-rpgmaker-mv"`, a precise title, and a Markdown body containing `## 现象`, `## 复现步骤`, `## 期望行为`, `## 实际行为`, `## 影响`, and `## 证据`.
4. Treat a returned issue number or URL as the creation confirmation. If the call times out or its result is ambiguous, do not retry automatically; state that reporting is unverified so a duplicate is not created.
5. Mention the created or existing issue briefly in the final task summary. Do not make the issue itself the substitute for completing the user's requested work.

The native Forgejo MCP surface is general. Use only these two calls for automatic reporting, always with the fixed owner and repository above. If reporting is not configured, explain the missing configuration without printing or requesting a token in chat.
