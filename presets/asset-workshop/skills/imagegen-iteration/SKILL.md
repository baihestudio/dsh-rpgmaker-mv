---
name: imagegen-iteration
description: Direct Kepos image generation or image editing for RPG Maker assets when the user needs new art, a visual variant, or a model-assisted repair; not for exact pixel, sheet, atlas, or lossless operations.
---

# Image-generation iteration

Use DSH's `kepos_image_generate` tool. Omit `images` for a new PNG; provide one to
five PNG, JPEG, GIF, or WebP paths relative to the active workspace for an edit. The
tool saves a candidate below `.dsh/kepos-imagegen/`; retain the returned path. It is
not a raw ImageMagick command and does not replace deterministic `magick` work.

## Close the visual question first

Before generating, inspect supplied references and resolve only the visual decisions
that would materially alter the result: first read, player-facing purpose, target
canvas or RPG Maker asset role, palette/style, and any defining silhouette, pose,
or text. Ask through `ask_user_question` only when a user-owned visual choice is
materially ambiguous; give options and a recommendation. Do not generate variants to
hide an unresolved concept.

For a named game, character, product, or style, use official pages, trailers,
character pages, or developer material as reference where reachable. Separate
identity cues from mood and prop/interaction cues. Treat community images and posts
as leads, not proof of canonical details.

## Generate and iterate by diagnosis

Write a compact hierarchical prompt: primary subject/action, one optional delayed
read, visual style and palette, then essential asset constraints. For an edit, name
the exact source path and start with a preserve instruction; list the regions that
must remain unchanged, then one local repair. Do not restate a full scene when the
user asked to fix one defect.

After each candidate, inspect it at thumbnail and intended in-game scale. Record the
candidate path, what works, the single visible defect, and the next targeted change.
Preserve successful elements; change one recognition, pose, silhouette, contact,
composition, or readability variable per iteration. If the failure is conceptual,
return to the unresolved question before calling the tool again.

## Hand off to deterministic preparation

Use the `asset-workshop` `magick` CLI contract after visual approval whenever the
asset needs pixel-safe scaling, transparent-border trim/pad, sprite-sheet slicing or
assembly, or PNG preparation. Inspect source and result metadata and never overwrite
an existing source or output. Generated images are not evidence that their final
dimensions, alpha, sheet layout, or RPG Maker compatibility are correct; verify
those properties with `magick identify`.

Finish when the approved candidate's relative path, intended asset role, visual
decision, deterministic preparation (if any), and remaining integration check are
clear. Do not claim it is in the game until another agent has integrated and tested
it.
