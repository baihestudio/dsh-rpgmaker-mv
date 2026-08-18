---
name: asset-workshop
description: Deterministic, Windows-first RPG Maker MV image transformations with output manifests and fidelity checks.
---

# Asset Workshop

Use the harness-owned image workflow for every raster transformation. Do not
write an ImageMagick command from memory, use `convert`, use a PATH-discovered
binary, or invoke a user-provided shell wrapper. The launcher exposes the
resolved command through `DSH_IMAGE_WORKSHOP_CLI`; pass paths as separate
arguments and keep the selected project/source files untouched.

The supported outcome operations are:

- `resize-pixel`: integer nearest-neighbour scaling only; reject non-integer
  scales rather than introducing a smoothing filter.
- `trim-pad`: trim transparent borders and/or pad to an explicit canvas with a
  transparent background.
- `sheet-slice`: fixed cell width/height, row-major frame order, PNG frame files
  and a JSON frame manifest.
- `sheet-assemble`: row-major PNG assembly from equal-sized cells.
- `atlas-pack`: pinned `free-tex-packer-core@0.3.9`, nearest-neighbour,
  no-rotation defaults, optional padding/extrusion, and JSON frame metadata.
  `--output` is a new output directory; the PNG, JSON, and `manifest.json` are
  committed together by one atomic directory rename.
- `optimize-png`: an explicit release-only post-pass through pinned
  `oxipng@10.2.0`; never call it as an implicit part of editing.

Invoke the CLI with the operation name and its flags. For example:

```text
bun "$DSH_IMAGE_WORKSHOP_CLI" image resize-pixel --input <source.png> --output <new.png> --scale 3
bun "$DSH_IMAGE_WORKSHOP_CLI" image trim-pad --input <source.png> --output <new.png> --trim --width 64 --height 64
bun "$DSH_IMAGE_WORKSHOP_CLI" image sheet-slice --input <sheet.png> --output-dir <frames> --cell-width 48 --cell-height 48
bun "$DSH_IMAGE_WORKSHOP_CLI" image atlas-pack --inputs-json '["a.png","b.png"]' --output <new-atlas-directory> --max-size 2048 --fixed-grid
bun "$DSH_IMAGE_WORKSHOP_CLI" image optimize-png --input <verified.png> --output <release.png> --level 4
```

Every mutating operation must report its JSON manifest and inspect the output
before claiming success. The manifest records resolved tool paths and versions,
input/output dimensions, format, channels, alpha mode, hashes, options, and
fidelity evidence. Atlas output is a new directory containing its PNG, JSON,
and `manifest.json`; a pre-existing output directory is a collision. Other
operations preserve the manifest beside the output. Never replace a source
file, even during an explicit optimization; use a distinct release output.

The workflow has bounded ImageMagick resource and time limits. Treat malformed
inputs, non-zero exits, missing output files, failed dimension/alpha checks,
failed pixel checks, and incomplete atlas JSON as actionable failures. Paths
may contain spaces and CJK characters; do not quote or concatenate them into a
shell command string.

The optional Photoshop, Aseprite, and TexturePacker paths in the manifest are
capability hints only. They are user-owned enhancements: do not download,
redistribute, require, or silently invoke them. PNG/MV work falls back to the
pinned ImageMagick/helper path. WebP is not an MV-safe replacement unless the
user explicitly supplies a compatible runtime/plugin plan.
