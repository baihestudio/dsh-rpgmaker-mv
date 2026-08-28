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
3. **Add the four new-session quick starts through the official input dock.**
   The conversation package has no hero-specific suggestions slot, but its
   `conversation.input.dock` list is explicitly the full-width row above the
   composer card. In a selected Workspace's blank Session it has the session
   and input state plus the supported `inputActions.setDraft` action. This is
   sufficient for product-owned chips that fill, but never send, a prompt.
   A generic prompt-template package remains unnecessary.

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

That same conversation contract defines `conversation.input.dock` as a
session-scoped list for a full-width row stacked above the composer card. Its
owner currency contains the current conversation and input snapshots, while
the session standard kit supplies the public input actions. The pinned rc.2
implementation renders that dock in the blank-session hero after a Workspace
has been selected, immediately before the input bar. It does not render before
a Workspace has created or selected a Session, which is appropriate because
the recommended Skills need a project context.

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
| Clickable prompt templates | [`dsh-prompt` 0.1.6](https://www.npmjs.com/package/dsh-prompt), published 2026-08-22; it installs an input-left button, composer overlay, `/prompt` input trigger, settings page, draft-insertion behavior, and an optional smart card. Its panel uses the supported input actions, while the smart-card/settings fallbacks also query textarea/button DOM. [Published source](https://www.npmjs.com/package/dsh-prompt) | **Reject as a bundled dependency.** It is a broad generic toolbox, and its extra settings, template store, matching engine, DOM fallbacks, and global overlay are unnecessary for four fixed product actions. Reuse the official slot/action pattern in the release-owned UI bundle instead. |

## Smallest product slices

### Branding — recommended next slice

Add one release-owned client bundle that registers only the three official
brand slots above. Keep the mark and the `RPG Maker Agent` display name inside
that package. It has no host route, filesystem, tool,
credential, or build-script permission; normal app-managed-profile rebuild
continues to own its exact version and removal.

### Four new-session examples — use the input dock

Contribute one compact 2-by-2 quick-start row from the existing release-owned
UI bundle. Render it only while the selected Session's composer phase is
`blank` and its draft is empty. The four visible actions should name their
Skills: game design (`game-design`), project editing (`rpgmaker-mv`), image
assets (`image-assets`), and Playtest diagnosis (`playtest-debug`). Clicking an
action calls the supplied draft setter with a complete starter prompt and does
not submit it. The row disappears once the user types or selects an action.

`game-design-bootstrap` remains a conditional prerequisite selected by the
Agent when the project lacks a maintainable design-document foundation; it is
not a permanent fifth product action. Do not add settings, personalization,
analytics, random ordering, a generic prompt library, a shell overlay, or DOM
queries. If DSH later adds a dedicated hero suggestions slot, the same
component and prompt definitions can move without changing the behaviour.

## Unverified items

No candidate was installed, executed, or tested on the NUC. Package publish
dates/versions above are npm registry observations on the research date, not
long-term maintenance guarantees. The existing Web profile's live bundle list
was not inspected; whether `ui-deliverables` or `ui-reference` is already
present needs a local profile inspection before any implementation decision.
