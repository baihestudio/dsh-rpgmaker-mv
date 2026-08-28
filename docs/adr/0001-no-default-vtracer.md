# ADR 0001: Do not install VTracer by default

## Status

Accepted

## Context

RPG Maker MV normally consumes raster PNG assets: sprites, character sheets,
tilesets, pictures, UI, and icon sheets. The supported asset workflow uses Kepos
for visual candidates and ImageMagick's global `magick` command for deterministic
raster preparation.

VTracer converts raster images to SVG paths. It may help a later, explicitly
requested logo or web-vector workflow, but it does not replace chroma-key cleanup,
pixel-art scaling, alpha handling, sprite-sheet preparation, or PNG verification.
Its current Windows release line is also pre-release.

## Decision

Do not install, provision, validate, or mention VTracer in the shipped Agent
prompts and image Skills. Do not add it to Windows PATH or installer prerequisites.

Keep the research record at `docs/research/vtracer-windows-runtime-research.md`.
Reconsider only for a concrete SVG-consuming product workflow, with a stable release
and a separately scoped asset contract.

## Consequences

The default Windows image dependency remains one tool: WinGet-installed
ImageMagick 7, exposed as `magick`. The image Agent remains focused on PNG work
without an irrelevant vectorization branch.
