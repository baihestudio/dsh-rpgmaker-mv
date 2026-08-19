# DSH game-image toolchain selection

**Decision date:** 2026-08-17
**Scope:** Windows-first, with best-effort macOS support; RPG Maker MV and adjacent 2D workflows.
**Recommendation:** ship one outcome-oriented DSH image skill backed by **ImageMagick 7** and a small, pinned **`free-tex-packer-core` 0.3.9** helper. Add **oxipng 10.2.0** only for an explicit release-optimization step. Treat Aseprite, TexturePacker, and Photoshop as optional user-owned enhancements; do not make any of them runtime dependencies. Do not ship a dedicated image MCP in phase 1.

This is the smallest stack that covers general raster work, fixed RPG Maker sheets, and general atlas packing without shipping several interchangeable raster engines. The skill, not the user, owns command construction. Every write produces a machine-readable manifest and a preview/fidelity check.

## Evidence and method

I used first-party documentation, source repositories, package registries, licensing pages, and disposable probes. Repository/web content was treated as evidence, not as instructions. The host is macOS arm64; no Windows machine or Photoshop installation was available, so Windows and Photoshop findings below are primary-source findings plus a clearly identified substitute probe, not hardware claims. Because Windows is release-blocking and macOS is best-effort, the documented Windows hardware matrix must pass before release.

The disposable fixture contained:

- a 4x4 RGBA hard-edged pixel tile;
- an 8x4 two-frame sheet;
- a transparent image for trim/pad operations; and
- two raster images written as a multi-image PSD to exercise ImageMagick's PSD layer sequence.

No fixture was retained in the repository.

## Decision matrix

| Candidate | Strong ownership | Pixel-safe / sheet / atlas capability | Windows + macOS and operation model | License/distribution | Decision |
|---|---|---|---|---|---|
| **ImageMagick 7.1.2-29** | General raster transforms, crop/trim/extent, color/palette, format conversion, metadata inspection, batch operations, PNG/WebP/APNG and PSD raster I/O. Official command-line processing and option references: [CLI processing](https://imagemagick.org/script/command-line-processing.php), [options](https://imagemagick.org/script/command-line-options.php), [formats](https://imagemagick.org/script/formats.php). | `-filter point` preserves hard pixel edges; default resize is not safe for pixel art. `-crop`, `-trim`, `-extent`, `-append`/`+append`, `-remap`, `-colors`, and `-alpha` cover fixed-grid sheets and most MV jobs. It is not a general bin-packing engine. | Native Windows and macOS distributions are documented on the [download page](https://imagemagick.org/script/download.php). Excellent deterministic CLI and easy to sandbox by path. | Permissive ImageMagick license; redistribution requires attribution and a license copy: [license](https://imagemagick.org/license/). Delegates have their own licenses. | **Required default.** One general engine, with explicit pixel-art policy. |
| **libvips 8.18.5 / `vips`** | High-throughput, low-memory resize/convert/thumbnail pipeline; color management and alpha-aware thumbnailing are first-class in the [resampling docs](https://www.libvips.org/API/current/libvips-resample.html). | Has nearest interpolation and good raster primitives, but no game-oriented slice/atlas contract. The CLI/API is less approachable for a natural-language wrapper than ImageMagick. | Cross-platform build/install paths are documented at [libvips install](https://www.libvips.org/install.html); native library/delegate packaging is a larger surface. | LGPL-2.1: [repository](https://github.com/libvips/libvips). | **Rejected as default.** A good future bulk-processing backend, not a second engine to ship now. |
| **Sharp 0.35.3** | Very fast Node API over libvips; explicit `nearest` resize kernel and compositing/format APIs: [resize](https://sharp.pixelplumbing.com/api-resize/), [output](https://sharp.pixelplumbing.com/api-output/). | Strong for a custom JS service, but Sharp is a Node library, not a user-facing CLI; it does not solve sheet layout or PSD/layer automation. Adding a Node wrapper duplicates the skill seam. | Prebuilt binaries and platform support are documented at [installation](https://sharp.pixelplumbing.com/install/), but a Node runtime and dependency install become part of the image path. | Apache-2.0: [package/source](https://github.com/lovell/sharp). | **Rejected for phase 1.** Use only if a later DSH service already needs an in-process JS image API. |
| **Aseprite CLI** | Pixel-art authoring semantics, animation frames, slices, palette workflows, and sprite-sheet plus JSON export. Official [CLI reference](https://www.aseprite.org/docs/cli/) and [sprite-sheet docs](https://www.aseprite.org/docs/sprite-sheet/). | Best specialist for authored pixel art and animation metadata. It can export sheets, but fixed RPG Maker layouts still need a profile-specific contract. | Official builds target Windows/macOS/Linux; the CLI is bundled with the app. It is a local executable, not headless Photoshop. | Official releases/source are under the Aseprite EULA, with separate MIT components: [license notes](https://github.com/aseprite/aseprite#license). Do not redistribute the app binary without the applicable rights. | **Optional enhancement.** Detect a user installation for `.aseprite` files and animation/slice export; fall back to ImageMagick for PNG-only work. |
| **TexturePacker** | Mature atlas packing, trim/rotation/padding/extrusion, JSON and engine-specific metadata, and a documented CLI: [CLI docs](https://www.codeandweb.com/texturepacker/documentation/command-line). | Strongest polished atlas UX and output-format breadth. Rotation/trim defaults must be disabled for fixed RPG Maker sheets. | Official Windows/macOS app and CLI; requires local installation/licensing. | Commercial product with trial/free-mode limits and license terms on [CodeAndWeb licensing](https://www.codeandweb.com/texturepacker/license). | **Optional enhancement, not a dependency.** Prefer it when a user already owns it or needs its exporters. |
| **`free-tex-packer-core` 0.3.9** | A small Node library for MaxRects packing, trim, padding, extrusion, optional rotation, PNG/JPG/WebP, and JSON/engine exporters. Primary package evidence: [npm package](https://www.npmjs.com/package/free-tex-packer-core), [source](https://github.com/odrick/free-tex-packer-core). | Covers the missing atlas primitive. The skill can force `scaleMethod: NEAREST_NEIGHBOR`, `allowRotation: false`, and `allowTrim: false` for MV fixed-grid work, while allowing trim/rotation for ordinary atlases. It is not a standalone CLI, so DSH owns a tiny helper invocation. | Pure JS package; use the existing DSH Node runtime on both platforms. No native GUI or app control. | MIT, per the package metadata/README. | **Required small atlas helper.** Pin exactly and keep it behind the skill; do not expose its API to users. |
| **oxipng 10.2.0** | Lossless PNG recompression and safe metadata handling. Primary [repository/releases](https://github.com/oxipng/oxipng). | Does not transform art or pack sheets; useful after the skill has verified pixels and dimensions. | Releases include native Windows/macOS artifacts; otherwise build with Rust. | MIT. | **Optional release post-pass.** No need to make ordinary editing depend on it. |
| **pngquant** | Excellent lossy indexed-PNG compression and quality/size tradeoff. Primary [project site](https://pngquant.org/) and [source](https://github.com/kornelski/pngquant). | Can damage color fidelity and semi-transparent pixel-art edges if quality is not controlled. It is optimization, not editing or layout. | Windows/macOS binaries exist, but packaging/licensing must be handled carefully. | GPLv3-or-commercial according to the project site. | **Rejected for the default.** Offer only as an explicitly licensed, opt-in release tool. |
| **Dedicated image/Photoshop MCPs** | Model-facing discovery and, for some adapters, control of a running desktop app. A representative current adapter is [dcc-mcp-photoshop](https://github.com/dcc-mcp/dcc-mcp-photoshop), built on the [dcc-mcp control plane](https://github.com/dcc-mcp/dcc-mcp-core). | MCP does not improve interpolation, alpha, or atlas correctness. A CLI skill can validate outputs more deterministically and has fewer tools/permissions. Photoshop adapters additionally require a running app/plugin and can encounter modal UI state. | Varies by project and adapter; no stable, first-party Adobe MCP contract was found. | Varies; do not assume the repository license or maintenance is sufficient for distribution. | **Not justified in phase 1.** Reconsider only for a demonstrated Photoshop-only workflow that UXP cannot cover through a local skill bridge. |

## Workflow ownership

| Workflow | Default implementation | Non-negotiable policy |
|---|---|---|
| Pixel-art resize | ImageMagick | Require integer scale for nearest-neighbour jobs and emit `-sample WxH!`; never silently use the default filter. `-sample` preserves hidden RGB under fully transparent pixels where `-filter point -resize` normalizes it, so strict full-RGBA verification stays exact. |
| Crop / trim / pad | ImageMagick | Use explicit geometry. Pad with `-background none` unless the request explicitly asks for a matte. Record source and destination rectangles. |
| Transparency / matte cleanup | ImageMagick | Preserve alpha by default. Color-key or matte removal must be explicit and previewed against both light and dark checkerboards. |
| Palette / color operations | ImageMagick | Prefer an explicit palette/remap or `-colors N -dither None`; verify palette size, alpha mode, and representative pixel values. |
| Tileset and character-sheet layout | ImageMagick | Use fixed cell width/height and deterministic row-major crop/append. Do not trim or rotate RPG Maker cells. |
| Sprite-sheet slicing/assembly | ImageMagick for PNG fixed grids; Aseprite CLI when `.aseprite` slices/animation metadata are the source of truth | Always write a JSON manifest containing frame order, rectangles, source dimensions, and origin. |
| General texture atlas packing | `free-tex-packer-core` helper | Default to no rotation for MV; use padding/extrusion to avoid texture bleeding; return the atlas JSON beside the PNG. |
| Batch rename/convert/optimize | ImageMagick plus the skill's path-safe file loop; oxipng for explicit PNG release optimization | Never use shell glob expansion on an untrusted path; reject collisions and preserve extension policy. |
| PNG/WebP | ImageMagick; oxipng optional for final PNG | WebP is not a drop-in RPG Maker MV asset format. Do not replace an MV PNG unless the user asks for a compatible runtime/plugin path. |
| PSD/layer/template automation | Photoshop UXP only when Photoshop is installed; ImageMagick only for rasterized preview/flattening | Never round-trip a production layered PSD through ImageMagick when layer fidelity matters. |

## Hands-on probes

### ImageMagick probe (macOS arm64)

Installed binary:

```text
ImageMagick 7.1.2-11 Q16-HDRI aarch64
Delegates include lcms, png, tiff, webp, zip, zlib
Formats report: APNG rw+, PNG rw-, PSD rw+, WEBP rw+
```

The probe commands were run in a temporary directory and removed afterward:

```sh
magick -size 4x4 xc:none \
  -fill '#ff0000' -draw 'rectangle 0,0 1,1' \
  -fill '#0000ff' -draw 'rectangle 2,2 3,3' pixel.png
magick pixel.png -filter point -resize 8x8 point.png
magick pixel.png -resize 8x8 default.png
magick sheet.png -crop 4x4 +repage frame-%d.png
magick pixel.png -background none -gravity center -extent 8x8 padded.png
magick pixel.png sheet.png layers.psd
```

Observed results:

- `-filter point` kept the red 2x2 block as exactly red pixels and left the transparent area alpha 0; no blended edge colors appeared. It does, however, normalize hidden RGB under alpha-0 pixels: a transparent-white source (`#FFFFFF00`) becomes `#00000000`. `-sample 8x8` performs the same integer nearest-neighbour scaling while preserving the hidden RGB (`#FFFFFF00` stays `#FFFFFF00`), which is why production pixel-safe resize uses `-sample`.
- Default `-resize` introduced partially covered red edge pixels (for example alpha values 193 and 62) and transparent pixels retaining red RGB. That is visually/semantically unsafe as an unannounced pixel-art default.
- `-crop 4x4 +repage` produced two 4x4 frames in source order.
- `-background none -extent` retained transparency. A non-`none` background deliberately produced an opaque matte, proving why the skill must not choose a background implicitly.
- Writing two raster inputs to PSD and reopening it produced two PSD image frames (`4x4` and `8x4`). This is useful raster-layer smoke coverage only; it does **not** establish preservation of Photoshop adjustment layers, smart objects, text, effects, masks, or color-profile semantics.

A 100-file `mogrify -path out -resize 16x16` batch completed in 0.07 seconds on this host and emitted 100 files. This is a small-startup smoke measurement, not a cross-machine benchmark; it supports using ImageMagick's batch mode rather than starting one process per asset.

### Atlas probe (`free-tex-packer-core` 0.3.9)

In a disposable directory I ran `npm pack free-tex-packer-core`, installed that tarball with `--ignore-scripts`, and packed two 4x4 RGBA images with:

```js
{
  textureName: "probe",
  width: 16,
  height: 16,
  padding: 1,
  allowRotation: false,
  allowTrim: false,
  scaleMethod: "NEAREST_NEIGHBOR",
  exporter: "JsonHash"
}
```

Observed output: `probe.png` was 6x12, `probe.json` described both source rectangles, and both `rotated` and `trimmed` were `false`. This verifies the proposed fixed-grid-safe setting and the package's basic PNG+JSON contract. It is not a quality comparison against TexturePacker; it is a focused capability probe.

### Unavailable platform-specific probes

- **Windows:** no Windows host was available. The smallest safe substitute was reading the vendor Windows install/CLI documentation and exercising only platform-neutral commands on macOS. Before release, run the same fixture using the pinned Windows binary and verify PowerShell quoting, Unicode paths, exit codes, and output hashes.
- **Photoshop:** Photoshop was not installed and no licensed layered PSD fixture was available. The substitute was a raster multi-image PSD probe plus Adobe's UXP API documentation. A Windows/macOS hardware check remains necessary for plugin installation, active-document behavior, modal prompts, save/export dialogs, and layer/template fidelity.

## Photoshop: optional enhancement only

Photoshop is valuable when a user already has a layered template, but it must never be a runtime dependency. Adobe's supported extension surface is UXP:

- [Photoshop UXP reference](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/)
- [`batchPlay`](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/batchplay/), for invoking Photoshop actions
- [`executeAsModal`](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/executeasmodal/), required for operations that change document state
- [Document API](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/document/), including layers and document operations

The proposed integration is a user-installed UXP plugin or an already-maintained local bridge, not an agent-controlled arbitrary socket:

1. The skill detects Photoshop/UXP availability and otherwise uses ImageMagick.
2. It asks the user to open/select the template and confirm the target document.
3. It sends a narrowly scoped operation (duplicate named layer, replace smart-object/content where supported, set text or visibility, export PNG) through a modal UXP command.
4. It waits for the plugin's explicit completion result; it does not assume that a launched process means success.
5. It exports a preview and checks dimensions, alpha, and expected layer names before reporting success.

Do not promise unattended Photoshop execution. Dialogs, unsaved documents, modal state, permissions, and version-specific UXP behavior must remain visible failure modes. Do not expose a generic `batchPlay` tool to the model; provide named allow-listed operations.

A third-party Photoshop MCP can be evaluated later as an adapter, but the current evidence does not establish a stable Adobe-maintained MCP contract. A dedicated MCP would add installation, process, app-state, and permission complexity without replacing deterministic CLI verification.

## Installation and version pinning

The implementation should own a small image-tool manifest rather than relying on whatever happens to be first on `PATH`. The initial tested pins are:

```text
ImageMagick 7.1.2-29       # release selected from the official release history
free-tex-packer-core 0.3.9 # npm package, exact version
oxipng 10.2.0              # optional release optimizer
```

The installed macOS probe was 7.1.2-11, which is evidence of behavior only; it is not the proposed release pin.

### Base installation

1. **ImageMagick:** obtain the official Windows installer/portable archive or macOS package from [ImageMagick downloads](https://imagemagick.org/script/download.php), record the exact asset URL, archive SHA-256, archived executable member, and installed executable SHA-256 in the app-owned DSH tool manifest, and verify before installation. On Windows the bootstrap uses `Get-FileHash`; on macOS it uses `shasum -a 256`. Do not use an unversioned `convert` alias. Preflight must invoke the manifest's `magick` path and require the pinned `7.1.2-29` (or fail with an upgrade message). Explicit overrides carry their expected executable checksum or fail.
2. **Atlas helper:** install inside the versioned app-owned DSH skill runtime, not globally, with Bun. Use an exact `free-tex-packer-core@0.3.9` dependency, run the helper trust step, and verify both the Bun lock hash and the package's pinned npm integrity before use. The repository runtime does not duplicate the helper dependency. The helper is pure JS from the package's perspective and uses the existing DSH Node runtime on both operating systems.
3. **Optional oxipng:** download the `v10.2.0` artifact from [official releases](https://github.com/oxipng/oxipng/releases/tag/v10.2.0), verify the architecture-specific SHA-256 recorded in the manifest, and expose it only as `optimize_png`.
4. **Optional Aseprite/TexturePacker/Photoshop:** detect the user-installed app/executable; never silently download or redistribute it. Record the detected version and license-dependent capability in the preflight report.

A package-manager convenience path may be offered, but it is not the reproducibility path: Homebrew's `imagemagick` formula and WinGet's ImageMagick package are moving targets. If a package manager is used, install the requested version, run the exact-version preflight, and fail closed rather than silently accepting a newer or older build. The release artifact plus checksum manifest is the cross-platform source of truth.

### Security and command policy

- Invoke executables by resolved absolute path from the manifest; do not trust the ambient `PATH`.
- Pass user paths as argument-array elements, never through a shell-generated command string.
- Restrict reads/writes to the approved project/work directories and a temporary directory owned by the current job.
- Give each operation one unique sibling staging directory, reject an existing output directory/collision, canonicalize real source/output/temp parents, and commit only after verification. Use an atomic directory rename for directory outputs and an exclusive no-clobber file commit for file outputs; never overwrite source assets or a racing output.
- Set resource/time limits where the host runner supports them; ImageMagick has its own [resource-limit options](https://imagemagick.org/script/command-line-options.php#resource).
- Return non-zero exits and stderr as structured failures. A successful process is not enough: inspect the output.

## Proposed DSH skill interface

The skill should present outcome-level operations and hide all flags. Suggested internal operations:

```text
image.inspect(input)
image.resize_pixel(input, scale | width, height, output)
image.crop_trim_pad(input, crop?, trim?, canvas?, anchor?, background?, output)
image.clean_alpha(input, mode, threshold?, matte?, output)
image.palette(input, colors | palette_file, dither?, output)
image.sheet_slice(input, cell_width, cell_height, order, output_dir)
image.sheet_assemble(inputs, columns | rows, cell_size?, output)
image.atlas_pack(inputs, max_size, padding, extrusion, fixed_grid?, output)
image.batch_convert(inputs, format, naming, output_dir)
image.optimize_png(input, level, strip_policy, output)
image.psd_template(operation, document, named_inputs, output)
```

The agent-facing skill should infer the operation from requests such as:

- “Scale every character sheet to 3× without blurring the pixels.”
- “Split `Actor1.png` into 4 columns by 2 rows and give me a JSON frame manifest.”
- “Remove the transparent border, then pad each icon to 64×64 with transparent pixels.”
- “Build a 2048 atlas from these icons, keep their names, do not rotate them, and leave two pixels of bleed protection.”
- “Convert these source images to MV-safe PNGs and show me a before/after contact sheet.”
- “If Photoshop is open, put these portraits into the named template layers; otherwise prepare the PNGs and tell me what remains manual.”

### Required verification response

Every mutating operation returns:

- output paths and a JSON manifest;
- tool versions and the resolved executable path;
- input/output dimensions, color model, alpha mode, format, and file sizes;
- for sheets/atlases, every frame rectangle, order, rotation/trim flags, padding, and extrusion;
- source/output hashes and a truthful verification level; atlas results must not claim universal losslessness when only representative pixels were checked;
- a visual preview/contact sheet path, or a clear reason preview generation failed; atlas manifests enumerate both PNG and JSON artifacts;
- warnings for ICC profiles, metadata removal, matte colors, indexed alpha, WebP incompatibility, and any fallback.

The skill must generate/check a checkerboard preview for alpha work and compare hard-edge pixel samples for pixel-art resize. For atlas work it must parse its own JSON, verify every source name occurs exactly once, rectangles are in bounds and non-overlapping, fixed-grid jobs retain requested cell dimensions, and representative decoded source-to-atlas samples match. It must enforce aggregate input/output limits and the existing operation deadline. For PNG optimization it must compare decoded pixels/dimensions before and after, not just file hashes.

## Licensing and rejected alternatives

- **ImageMagick:** distributable with attribution and license copy under its [custom license](https://imagemagick.org/license/). Include the license and an inventory of delegate licenses in any DSH bundle.
- **`free-tex-packer-core`:** MIT; include its notice in the skill's dependency inventory. Pin npm resolution with a lockfile.
- **oxipng:** MIT; include its notice if bundled.
- **Aseprite:** do not bundle official binaries unless DSH has the applicable commercial distribution rights. Detect the user's copy instead.
- **TexturePacker:** do not bundle or automate its commercial features as though they were free. Detect a licensed installation; otherwise use the MIT atlas helper.
- **pngquant:** GPLv3-or-commercial makes it a poor default for a distributable profile. Its lossy behavior also needs an explicit quality policy.
- **libvips/Sharp:** technically strong, but adding either as another raster engine creates overlapping ownership. They are deferred, not technically dismissed.
- **Generic image MCPs:** no evidence showed a maintained, cross-platform, stable contract with better fidelity or verification than a focused skill. MCP discovery is useful for app control; it is not a substitute for deterministic local processing.
- **ImageMagick PSD round-trip:** rejected for layer-preserving template work. Use UXP for Photoshop-native documents and ImageMagick only for rasterized previews/exports.

## Final implementation decision

Implement one focused image skill with **ImageMagick 7.1.2-29 as the only general raster CLI**, **`free-tex-packer-core` 0.3.9 as the only atlas helper**, and **oxipng 10.2.0 as an opt-in release post-pass**. Use explicit nearest-neighbour and fixed-grid defaults for RPG Maker MV. Keep Aseprite, TexturePacker, and Photoshop behind capability detection and user confirmation. Do not add a dedicated MCP until a concrete Photoshop-only or desktop-app workflow demonstrates that the named UXP bridge cannot provide it.

## Primary sources

- [ImageMagick command-line processing](https://imagemagick.org/script/command-line-processing.php), [options](https://imagemagick.org/script/command-line-options.php), [formats](https://imagemagick.org/script/formats.php), [downloads](https://imagemagick.org/script/download.php), [license](https://imagemagick.org/license/)
- [libvips resampling API](https://www.libvips.org/API/current/libvips-resample.html), [installation](https://www.libvips.org/install.html), [source/license](https://github.com/libvips/libvips)
- [Sharp resize API](https://sharp.pixelplumbing.com/api-resize/), [installation](https://sharp.pixelplumbing.com/install/), [source/license](https://github.com/lovell/sharp)
- [Aseprite CLI](https://www.aseprite.org/docs/cli/), [sprite sheets](https://www.aseprite.org/docs/sprite-sheet/), [source/license](https://github.com/aseprite/aseprite)
- [TexturePacker CLI](https://www.codeandweb.com/texturepacker/documentation/command-line), [license](https://www.codeandweb.com/texturepacker/license)
- [`free-tex-packer-core` npm](https://www.npmjs.com/package/free-tex-packer-core), [source](https://github.com/odrick/free-tex-packer-core)
- [oxipng source and releases](https://github.com/oxipng/oxipng), [10.2.0 release](https://github.com/oxipng/oxipng/releases/tag/v10.2.0)
- [pngquant project/license](https://pngquant.org/), [source](https://github.com/kornelski/pngquant)
- [Adobe Photoshop UXP reference](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/), [`batchPlay`](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/batchplay/), [`executeAsModal`](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/executeasmodal/), [Document API](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/document/)
- [DCC MCP core](https://github.com/dcc-mcp/dcc-mcp-core), [Photoshop adapter](https://github.com/dcc-mcp/dcc-mcp-photoshop)
