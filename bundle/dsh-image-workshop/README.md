# dsh-image-workshop

App-owned, private, prebuilt DSH tool plugin. It is shipped inside the DSH for
RPG Maker MV Release ZIP, installed from the app-owned program tree, and
mounted only in the 游戏图片素材助手 (`asset-workshop`) preset composition, so
its tool registrations are scoped to that Agent.

The plugin registers seven typed tools that delegate to the existing Image
Workshop implementation through the harness CLI:

- `image_inspect` — decode and report image metadata (dimensions, format,
  channels, alpha, bytes, SHA-256).
- `image_resize_pixel` — integer nearest-neighbour pixel-safe scaling.
- `image_trim_pad` — trim transparent margins and/or pad a transparent canvas.
- `image_sheet_slice` — slice a sprite sheet into equal cell frames.
- `image_sheet_assemble` — assemble equal-sized images into one sprite sheet.
- `image_atlas_pack` — pack differently sized images into a PNG atlas + JSON map.
- `image_optimize_png` — lossless oxipng optimization preserving decoded pixels.

Array inputs (sheet assembly, atlas packing) are real schema arrays; they
travel to the CLI as a single JSON argv element, never as shell-encoded text.

All model-facing paths are project-relative and fenced to the Agent's
immutable workspace directory. Absolute paths, traversal escapes, symlink or
junction escapes, missing inputs, and outputs outside the workspace are
rejected before any subprocess starts. Source files are never overwritten and
pre-existing outputs are rejected. A cancelled tool call aborts the CLI child
process.

The plugin performs no build on the user's machine, fetches nothing from npm,
and has no runtime dependencies. It is not published.
