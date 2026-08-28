# DSH Web UI extension selection

**Research date:** 2026-08-28
**Scope:** candidates for the Windows RPG Maker MV release's app-managed
`web` profile. This note is research only: no package was installed and no
product configuration was changed.

## Recommendation

1. **Brand the surface with a tiny DSH-owned client plugin.** This is a stable,
   narrow use of official slots and lets the release own the mark/name rather
   than depend on a general-purpose skin.
2. **Do not ship a third-party file sidebar by default.** The closest candidates
   add a larger filesystem/terminal/Git workbench or rely on DOM surgery. Keep
   the existing workspace MCP as the project-file interaction path. Revisit a
   read-only, workspace-fenced explorer only after there is an observed need.
3. **Do not add a generic prompt-template package for the requested new-session
   quick starts.** It provides composer templates, not four chips in the empty
   session hero. The official Web composition has no such extension slot.
   Upstreaming a `conversation.hero.suggestions` list slot is the smallest
   durable route; replacing the whole conversation root is not justified.

## Confirmed extension seams

DSH's official slots package is a registered component contract: an extension
can contribute only to a slot declared by its parent, and registering into an
undeclared slot throws. [Official slots package](https://www.npmjs.com/package/@deepseek-ai/dsh-client-ui-slots)

The official brand package documents three appropriate seats:
`sidebar.brand.mark`, `sidebar.brand.name`, and
`conversation.hero.brand.mark`. It is gated to the upstream `official` build
profile, so it is evidence for the seam, **not** a package to include in this
custom release. [Official brand package README](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/client/ui-brand-official/README.md)

The official conversation contract exposes `conversation.hero.workspace`,
`conversation.hero.brand.mark`, and `conversation.hero.agentPreset`; it does
not declare a quick-prompt/suggestions seat. [Conversation slot contract](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/client/ui-conversation/src/client/contract/slots.ts#L120-L125)
The stock Web bundle composition likewise has no quick-start provider.
[Web bundle composition](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/bundle/web-app/cordis.patch.yml#L187-L254)

The currently shipped `@guionai/dsh-web@0.3.1` and
`@lamplitisles/dsh-imagegen@0.2.1` each declare the normal DSH bundle/client
mechanism and depend on the official slot runtime; their published metadata
does not advertise a sidebar, welcome-prompt, or product-branding feature.
[Guion package metadata](https://www.npmjs.com/package/@guionai/dsh-web),
[Kepos imagegen package metadata](https://www.npmjs.com/package/@lamplitisles/dsh-imagegen)

## Candidate assessment

| Need | Candidate and observed state | Fit with this release |
| --- | --- | --- |
| Files sidebar | [`dsh-sidebar-files` 0.1.0](https://www.npmjs.com/package/dsh-sidebar-files), published 2026-08-15; the package declares peer support around DSH rc.5/rc.6, while this release pins `0.1.1-rc.2`. Its own README says it finds/sidebar-injects DOM structure at runtime, and its listing route falls back to the account home directory when no path is supplied. [Package source](https://github.com/Fallen0543/dsh-sidebar-files) | **Reject.** Version mismatch plus DOM coupling, and a file browser must never silently broaden from the selected workspace to the home directory. |
| Files workbench | [`dsh-better-sidebar` 0.17.1](https://www.npmjs.com/package/dsh-better-sidebar), published 2026-08-28. It advertises rc.2 support and offers a file explorer/editor/preview, terminal, Git actions, embedded browser, background tasks, and optional agent-driven opens. Its installation instructions require approving `node-pty` build scripts. [Upstream README](https://github.com/omdsh-dev/DSH-better-sidebar/blob/main/README_EN.md), [published package metadata](https://www.npmjs.com/package/dsh-better-sidebar) | **Reject as a default dependency.** It is much broader than a file tree and adds native-build/install risk to the deliberately rebuilt profile. It could be evaluated manually as an opt-in power-user workbench, with a Windows acceptance test and explicit approval for its process/filesystem/Git capabilities. |
| Files sidebar | [`@kaijia/dsh-sidebar` 0.1.8](https://www.npmjs.com/package/@kaijia/dsh-sidebar), published 2026-08-27, claims rc.2 support and includes tree/preview/Git/file-watch functions. Its source mounts beside `#root` and changes that root's margin rather than using a formal sidebar slot. [Package source](https://github.com/kaijia323/dsh-sidebar) | **Reject.** It is layout-coupled and its filesystem/Git surface exceeds the requested read-only view. |
| Files visibility | Official [`@deepseek-ai/dsh-client-ui-deliverables`](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/client/ui-deliverables/README.md) exposes files created by agent mutations and opens `@file` references. | **Useful reference, not a tree.** Prefer it over a filesystem browser if the real need is “show what the agent just made.” Verify whether the selected Web composition already mounts it before adding anything. |
| Clickable prompt templates | [`dsh-prompt` 0.1.6](https://www.npmjs.com/package/dsh-prompt), published 2026-08-22; it installs an input-left button, composer overlay, `/prompt` input trigger, settings page, and draft-insertion behavior. [Published source](https://www.npmjs.com/package/dsh-prompt) | **Not the requested UI.** It is a generic template toolbox, not empty-session quick starts. It can be a personal opt-in, but should not be bundled into the focused RPG Maker product. |

## Smallest product slices

### Branding — recommended next slice

Add one release-owned client bundle that registers only the three official
brand slots above. Keep the SVG mark and the `DSH for RPG Maker MV`/Chinese
display name inside that package. It has no host route, filesystem, tool,
credential, or build-script permission; normal app-managed-profile rebuild
continues to own its exact version and removal.

### Four new-session examples — wait for a slot

Examples such as “检查这个 RPG Maker 项目”, “设计一个新任务”, “生成角色立绘”,
and “修复 Playtest 报错” should insert text into the draft, never send a turn.
The required empty-hero placement lacks a published extension point. The
proportionate request upstream is a list `conversation.hero.suggestions` slot
with the active session/input actions supplied by the parent. Until then,
putting cards there means replacing or probing private DOM, which carries the
same update fragility that disqualifies the sidebar candidates.

## Unverified items

No candidate was installed, executed, or tested on the NUC. Package publish
dates/versions above are npm registry observations on the research date, not
long-term maintenance guarantees. The existing Web profile's live bundle list
was not inspected; whether `ui-deliverables` or `ui-reference` is already
present needs a local profile inspection before any implementation decision.
