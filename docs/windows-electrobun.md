# RPG Maker Agent Electrobun adapter

This repository owns the RPG Maker product behavior. The reusable desktop
window, Bun recovery, WebView2 renderer, and Job Object supervisor remain in
the pinned `dsh-electronbun` checkout.

This adapter is the first live product example of that generic host contract,
not the host's product model. Other customized DSH distributions provide their
own manifest and sidecar while reusing the same unmodified host.

The adapter is a generated host workspace, not a second host implementation.
It does three product-specific things:

1. builds the thin `src/electrobun-sidecar.ts` entrypoint;
2. generates the product manifest for the pinned host; and
3. points the sidecar at the installed RPG Maker launcher and its existing
   product-owned roots.

The current adapter pins Bun `1.3.14`, matching the verified Windows
installation and the existing product's supported Bun contract. The generic
reference manifest's Bun `1.4.0` is not reused.

## Stage a host workspace

Use the current `windows-sidecar-host` checkout at the pinned commit:

```sh
bun run desktop:stage -- \
  --host-root /path/to/dsh-electronbun \
  --output-root /tmp/dsh-rpgmaker-electrobun
```

The output directory must be separate from both source repositories. It
contains the generic host source at the pinned revision, a generated
`product.manifest.ts`, the bundled product sidecar, the prebuilt Windows
supervisor, and `adapter-provenance.json`. That single machine-readable
handoff records the SHA-256 of the adapter source entrypoint and the bundled
sidecar; pass its exact object through to the native build's canonical
`desktop-host.json` descriptor as `sidecarProvenance`. The generated
`product.manifest.ts` remains the generic host manifest and does not duplicate
this handoff. The generic host's checked-in `electrobun.config.ts` remains
unchanged. The command refuses a different host revision or one with tracked
changes, and refuses a non-empty output directory unless it carries the
adapter's generated-output marker and `--force` is explicit.

Build and run the generated host with the native Windows Bun executable. Do
not use the WSL Linux Bun to launch a Windows Electrobun application. The
packaged sidecar derives the replaceable program root from its own staged
entrypoint location (`<program>\\desktop-host\\Resources\\app\\payload\\sidecar`),
so a user-selected installation root works without installer-only environment
variables. It writes bounded, structured startup summaries to the existing
per-user log root without persisting arbitrary caught error text. Tests may
inject a packaged entrypoint and test-owned local-state root through the
sidecar dependency seam; there is no legacy default installation-root fallback
in the packaged process.

It dynamically loads `src/rpgmaker.ts` from the installed program tree and
consumes the receipt-backed runtime, MCP/profile, preset, composition, and
live-contract artifacts committed by `Install.cmd`. The normal sidecar launch
does not bootstrap packages, repair the profile, regenerate presets, or run
MCP `tools/list`; it performs cheap path/ownership/port/readiness checks, uses
a direct `node.exe` for MCP children, and keeps Bun only as the desktop-host
runtime. The sidecar passes DSH's explicit `--no-open` flag and does not
provide a browser opener; the native WebView2 host loads the loopback page
after readiness.

Staging does not deploy or repair that installed product tree. Native smoke
tests must therefore use an installation produced from the same product
revision, with its complete `src/` module graph; mixing a newly staged adapter
with an older partial installation is unsupported. A stable release must ship
the product and adapter as one version-coherent installation.

For disposable adapter tests that reuse installed read-only binaries while
putting mutable DSH state in a test-owned Windows temporary directory, inject
the packaged entrypoint and local-state root through the existing sidecar
dependency seam. Do not set `DSH_RPGMAKER_DATA_ROOT` or `DSH_HOME` as a native
production-launch recipe: the packaged sidecar intentionally ignores those
ambient overrides. Do not run the smoke while another DSH session owns port
3081. The adapter does not stop or modify a user's running DSH session.

To package a release, provide the already-built host output as a
`--desktop-host-root` payload to the product release script. The product gate
verifies the pinned host revision, Bun version, canonical `desktop-host.json`
descriptor, and its `sidecarProvenance` object before copying it under
`desktop-host`. The provenance schema is versioned and contains the SHA-256 of
the current `src/electrobun-sidecar.ts` plus the packaged
`Resources/app/payload/sidecar/dsh-rpgmaker-sidecar.js`; stale source, missing
fields, or a tampered sidecar are rejected. The descriptor must also declare
the exact `sidecarEntrypoint` and `supervisorExecutable` payload files and the
native launch target. The native build should copy the staged values into a
descriptor object shaped like:

```json
{ "schemaVersion": 1, "adapterSourceSha256": "...", "sidecarSha256": "..." }
```

`Install.cmd` then targets that host from the Start Menu. The host build,
clean-machine provisioning, signing, and update delivery
remain outside this repository and are not performed by the installer.
