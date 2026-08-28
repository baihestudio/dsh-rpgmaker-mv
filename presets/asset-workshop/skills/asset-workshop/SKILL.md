---
name: asset-workshop
description: Prepare RPG Maker MV raster assets with Kepos for candidates and the globally installed ImageMagick magick CLI for deterministic workspace-local work.
---

# Asset Workshop

## Two lanes

Use `kepos_image_generate` only for a new visual candidate or model-assisted
edit. It saves a candidate under `.dsh/kepos-imagegen/` in the active workspace;
retain that relative path, inspect it at its intended in-game size, and ask for
approval before treating it as a final asset. If the Kepos bridge is unavailable,
say that its Settings bridge needs configuration; do not substitute another model.

Use the Windows-wide ImageMagick 7 command `magick` for deterministic raster work.
The launcher installs it with `winget install ImageMagick.ImageMagick --exact` and
expects every newly launched Windows program to see it through PATH. At the start
of a CLI image task, run `magick --version`; if it fails or is not ImageMagick,
report the missing prerequisite rather than guessing a path or using `convert`.

## CLI safety contract

- Work only inside the DSH Web-selected workspace. Use explicit input and output
  paths; never modify an input in place and never use `mogrify`.
- Before writing, ensure the output path does not already exist. Keep generated
  candidates and source files intact. Quote paths with spaces or CJK characters as
  separate shell arguments, never by building a shell command string.
- Inspect both ends: use `magick identify -verbose <path>` (or a concise
  `magick identify <path>`) for dimensions, format, and alpha. State the intended
  game-scale size in the handoff.
- Use PNG output for MV. Preserve alpha deliberately with `PNG32:<output>` where
  applicable. Do not silently substitute WebP, JPEG, SVG, or a lossy palette.
- Do not trim, rotate, resample, or otherwise alter a tileset/spritesheet unless
  the user supplied its cell/grid contract. Do not claim integration or playtest;
  hand it to the RPG Maker agent after preparation.

## Common recipes

Choose parameters from the actual asset; these recipes are starting points, not
blind commands.

- Pixel-art integer scaling: use `-filter point -resize <integer>x` and write a
  new PNG32 output. Reject non-integer scaling when crisp pixels are required.
- Green-screen extraction: first confirm the background is actually chroma green
  and whether green foreground details must survive. For a clean uniform backdrop,
  use `-alpha off -fuzz <tolerance> -transparent '#00FF00'`, then inspect edges.
  Start near 10–20%; lower tolerance protects green details, higher tolerance
  removes spill. Use `-trim +repage` only when changing the canvas origin is safe.
- Sprite-sheet slices: use `-crop <cellWidth>x<cellHeight> +repage` only after
  validating full-sheet dimensions divide exactly by the requested cell size. Write
  to a fresh output directory with stable zero-padded names.
- Lossless-ish delivery cleanup: prefer `-strip` only after confirming profile
  metadata is not needed; it removes metadata, not visual pixels. Do not describe
  arbitrary ImageMagick re-encoding as a guaranteed lossless optimizer.

For a generated or edited candidate, read `imagegen-iteration` first. For every
completed operation report input path, exact command/parameters, output path,
verified dimensions/format/alpha, and the remaining integration check.
