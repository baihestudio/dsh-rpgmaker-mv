# VTracer Windows runtime research

**Scope.** Primary-source research for deciding whether VTracer can be supplied
as an app-owned Windows runtime. No application code or installer files were
changed.

## Release and distribution facts

- The upstream project is [visioncortex/vtracer](https://github.com/visioncortex/vtracer).
  Its [latest GitHub release API response](https://api.github.com/repos/visioncortex/vtracer/releases/latest)
  reports [`1.0.0-alpha.3`](https://github.com/visioncortex/vtracer/releases/tag/1.0.0-alpha.3),
  published on 2026-08-01 and marked `prerelease: false`. The version is still
  SemVer *alpha*, so it is the latest upstream-published release but not a
  stable (non-prerelease) SemVer release.
- The last non-alpha release with a Windows CLI archive is
  [`0.6.4`](https://github.com/visioncortex/vtracer/releases/tag/0.6.4)
  (2024-04-20). Its GitHub release assets do not publish an asset digest. Later
  `0.6.x` tags are not equivalent to a Windows binary release, so they are not
  suitable as an app-owned, checksum-verified runtime.
- The latest release has an official Windows x86_64 MSVC archive:
  [`vtracer-x86_64-pc-windows-msvc.zip`](https://github.com/visioncortex/vtracer/releases/download/1.0.0-alpha.3/vtracer-x86_64-pc-windows-msvc.zip).
  The [official release asset record](https://api.github.com/repos/visioncortex/vtracer/releases/tags/1.0.0-alpha.3)
  publishes SHA-256
  `26fb07c440aa6dd0a9ac57a83db6ee2924ddf308bccf451e76b324bb61780dba`.
  A local download independently produced the same digest. The 968,006-byte ZIP
  contains one file, `vtracer.exe` (2,396,160 bytes).
- Upstream's [`LICENSE`](https://raw.githubusercontent.com/visioncortex/vtracer/1.0.0-alpha.3/LICENSE)
  is MIT. Retaining the copyright and MIT text in this product's third-party
  notices is required when distributing the binary.

## CLI contract

The upstream [README's Console App section](https://github.com/visioncortex/vtracer/blob/1.0.0-alpha.3/README.md#console-app)
documents the executable as `vtracer` (Windows: `vtracer.exe`):

```text
vtracer [OPTIONS] [INPUT] [OUTPUT]
vtracer input.png output.svg
vtracer --version
```

The documented input/output contract is raster input such as PNG/JPEG to an SVG
output. The CLI supports color/binary/watershed clustering, `pixel`, `polygon`,
and `spline` curve fitting, palette restriction/quantization, and output
simplification. The source distribution's documented source-install alternative
is `cargo install vtracer-cli`; a Windows release installer should use the
published ZIP instead of requiring Cargo.

## Asset-workshop fit and limits

VTracer is a **raster-to-SVG tracer**, not a general image-processing command:
it cannot replace ImageMagick for chroma-key/green-screen removal, alpha-mask
editing, cropping, PNG export, spritesheet assembly, or raster optimization.

- **Useful:** flat-color icons, logos, UI glyphs, line art, and illustrations
  that need a scalable SVG. For controlled palettes, use `--palette` or
  `--max-colors`; for flat areas, the documented `--hierarchical cutout` mode
  creates a seam-free mosaic.
- **Pixel sprites:** upstream explicitly says it can handle low-resolution
  pixel art and documents `--mode pixel`. This can be a deliberate way to make
  a pixel-art SVG, but it is not a substitute for a PNG sprite sheet: output is
  SVG, and any later rasterization can change pixel alignment, palette, or
  visual crispness. Keep the original PNG as the game runtime asset unless an
  SVG consumer is explicitly required.
- **Not a default for photos or generated textured art:** VTracer supports
  photographs, but tracing converts them into many vector regions/paths. That
  can create heavy SVGs and stylistic artifacts; use it only when a vector
  deliverable is intended and inspect the result.

The capabilities and cautions above follow the upstream
[README](https://github.com/visioncortex/vtracer/blob/1.0.0-alpha.3/README.md),
which describes its raster-to-SVG purpose, the pixel-art mode, and the listed
CLI options.

## Decision implication

For a checksum-pinned, app-owned Windows runtime, `1.0.0-alpha.3` is the only
current upstream release choice with an official Windows x86_64 CLI archive and
published digest. Its alpha status is a product-risk decision, not something
the installer should conceal. If the product requires a non-alpha VTracer,
`0.6.4` is the last published option, but its Windows archive lacks an
upstream-published checksum and is therefore a weaker supply-chain choice.
