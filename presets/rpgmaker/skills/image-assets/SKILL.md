---
name: image-assets
description: Handle an RPG Maker MV or MZ image asset when the task needs new art, a visual edit, pixel scaling, transparency cleanup, cropping, or sprite-sheet preparation.
---

# RPG Maker image assets

Decide whether the request needs a visual candidate or deterministic preparation.

For a new image or model edit, resolve only the visual choice that materially
changes the result: asset role, target size/grid, palette or style, and defining
silhouette or text. Use `ask_user_question` when that choice remains ambiguous.
Use official game material as the authority for named characters or products.
Call `kepos_image_generate`; for an edit, preserve the supplied image and name one
local repair. Inspect candidates at intended in-game scale and iterate on one
visible defect at a time.

For deterministic work, use `magick` with a distinct output path. Keep MV assets
as PNG and inspect the result with `magick identify`. Preserve fixed grids: do not
trim, resize, or crop a tileset or sprite sheet until its cell dimensions are
known.

- Pixel art for either RPG Maker engine: use integer nearest-neighbour scaling (`-filter point -resize`).
- Green screen: confirm whether green foreground detail must survive, then tune
  `-fuzz` with `-transparent '#00FF00'`; use `-trim +repage` only when changing
  canvas origin is safe.
- Sprite-sheet slicing: validate that the sheet dimensions divide exactly by the
  requested cell size before using `-crop <cellWidth>x<cellHeight> +repage`.

After preparation, place or reference the approved PNG through the normal RPG
Maker task flow and validate the selected project when the change affects game
content. The image workflow does not add MZ Playtest or build support.
