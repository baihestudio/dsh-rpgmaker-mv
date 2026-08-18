# dsh-image-workshop

App-owned, private, prebuilt DSH tool plugin. It is shipped inside the DSH for
RPG Maker MV Release ZIP, installed from the app-owned program tree, and
mounted only in the 游戏图片素材助手 (`asset-workshop`) preset composition, so
its tool registrations are scoped to that Agent.

The plugin registers two typed tools that delegate to the existing Image
Workshop implementation through the harness CLI:

- `image_inspect` — decode and report image metadata (dimensions, format,
  channels, alpha, bytes, SHA-256).
- `image_resize_pixel` — integer nearest-neighbour pixel-safe scaling.

All model-facing paths are project-relative and fenced to the Agent's
immutable workspace directory. Absolute paths, traversal escapes, symlink or
junction escapes, missing inputs, and outputs outside the workspace are
rejected before any subprocess starts.

The plugin performs no build on the user's machine, fetches nothing from npm,
and has no runtime dependencies. It is not published.
