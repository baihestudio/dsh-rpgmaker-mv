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
`product.manifest.ts`, the bundled product sidecar, and the prebuilt Windows
supervisor. The generic host's checked-in `electrobun.config.ts` remains
unchanged. The command refuses a different host revision or one with tracked
changes, and refuses a non-empty output directory unless it carries the
adapter's generated-output marker and `--force` is explicit.

Build and run the generated host with the native Windows Bun executable. Do
not use the WSL Linux Bun to launch a Windows Electrobun application. The
sidecar defaults to the existing per-user product roots:

```text
%LOCALAPPDATA%\Programs\BaiheStudio\DSH-RPGMaker-MV
%LOCALAPPDATA%\BaiheStudio\DSH-RPGMaker-MV
```

It dynamically loads `src/rpgmaker.ts` from the installed program tree,
reusing the existing DSH runtime bootstrap, MCP/profile preparation, session
lease, fixed `127.0.0.1:3081` binding, launch log, and project-neutral
workspace behavior. The sidecar passes DSH's explicit `--no-open` flag and
does not provide a browser opener; the native WebView2 host loads the loopback
page after readiness.

Staging does not deploy or repair that installed product tree. Native smoke
tests must therefore use an installation produced from the same product
revision, with its complete `src/` module graph; mixing a newly staged adapter
with an older partial installation is unsupported. A stable release must ship
the product and adapter as one version-coherent installation.

For a disposable smoke that reuses installed read-only binaries while putting
mutable DSH state in a test-owned Windows temporary directory, set
`DSH_RPGMAKER_DATA_ROOT` and `DSH_HOME` for the host process. Do not run the
smoke while another DSH session owns port 3081. The adapter does not stop or
modify a user's running DSH session.

To package a release, provide the already-built host output as a
`--desktop-host-root` payload to the product release script. The product gate
verifies the pinned host revision, Bun version, and canonical `desktop-host.json`
descriptor before copying it under `desktop-host`. That descriptor must declare
the exact `sidecarEntrypoint` and `supervisorExecutable` payload files as well
as the native launch target. `Install.cmd` then targets that host from the
Start Menu. The host build, clean-machine provisioning, signing, and update
delivery remain outside this repository and are not performed by the installer.
