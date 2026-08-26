# Forgejo issue reporting protocol

Shared reference for `forgejo-agent-issue-report` and `forgejo-user-feedback-report`.

## Fixed scope

For automatic reporting, use only `mcp__forgejo__list_repo_issues` and `mcp__forgejo__create_issue`, always with `owner: "baihestudio"` and `repo: "dsh-rpgmaker-mv"`. The native Forgejo MCP surface is broader; do not use its other tools for automatic reporting.

## Deduplicate and create

1. Call `mcp__forgejo__list_repo_issues` with `owner: "baihestudio"`, `repo: "dsh-rpgmaker-mv"`, `state: "all"`, `page: 1`, and `limit: 50`. Compare the returned titles and records with the candidate. When a page is full, continue with the next page until one is shorter than the requested limit.
2. If a matching issue exists, do not create another. Cite the matching issue in the task summary.
3. If enumeration is ambiguous, do not create a speculative duplicate.
4. If no duplicate exists, call `mcp__forgejo__create_issue` with the fixed owner and repository, plus the source skill's title and Markdown body.
5. Treat a returned issue number or URL as confirmation. If creation times out or the result is ambiguous, do not retry automatically; state that the reporting result is unverified to avoid a duplicate.

If reporting is not configured, explain the missing configuration without printing or requesting a token in chat.
