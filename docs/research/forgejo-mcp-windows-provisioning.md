# Forgejo MCP Windows provisioning feasibility

**Scope:** upstream `agentic-forges/forgejo-mcp`, researched against the
canonical migrated repository and release `v2.34.1`. No product code, Git
state, binaries, NUC, or Forgejo issues were changed or used.

## Executive finding

`v2.34.1` is the upstream latest release observed in the release metadata.
[latest-release metadata](https://git.b4mad.industries/api/v1/repos/agentic-forges/forgejo-mcp/releases/latest). Its
release tag points to commit `223874f344d34c8922a6b299c83ec368b902e1a0`, and the
Forgejo API marks the tag signature as verified by the upstream release agent.
[release metadata](https://git.b4mad.industries/api/v1/repos/agentic-forges/forgejo-mcp/releases/tags/v2.34.1),
[tag verification metadata](https://git.b4mad.industries/api/v1/repos/agentic-forges/forgejo-mcp/git/tags/2b696f7e387decf364e48a02f377e8e25a98fdc8)

**It does not publish a Windows executable or Windows archive.** The
`v2.34.1` release assets contain Linux and Darwin archives/MCPB packages,
SBOMs, and checksums, but no `windows_*` asset.
[release page](https://git.b4mad.industries/agentic-forges/forgejo-mcp/releases/tag/v2.34.1),
[release API asset list](https://git.b4mad.industries/api/v1/repos/agentic-forges/forgejo-mcp/releases/tags/v2.34.1)
The tagged GoReleaser configuration is explicit: it builds only `linux` and
`darwin` for `amd64` and `arm64`; its Windows archive override is therefore
currently unreachable.
[`.goreleaser.yml` at `v2.34.1`](https://git.b4mad.industries/agentic-forges/forgejo-mcp/raw/tag/v2.34.1/.goreleaser.yml)

## 1. What a reproducible Windows build would require

The upstream source is a Go module whose tagged `go.mod` requires Go `1.25.5`
and pins its direct and transitive dependency graph through `go.mod` and
`go.sum`; Go defines the `go` line as the module's minimum required Go version.
[`go.mod`](https://git.b4mad.industries/agentic-forges/forgejo-mcp/raw/tag/v2.34.1/go.mod),
[`go.sum`](https://git.b4mad.industries/agentic-forges/forgejo-mcp/raw/tag/v2.34.1/go.sum),
[Go toolchain-version semantics](https://go.dev/doc/toolchain).
The smallest DSH-owned build recipe should therefore record all of:

- the verified upstream tag and commit above;
- an exact Go toolchain version at least `1.25.5` (prefer an exact pinned
  version, not `latest`);
- the tagged `go.mod`/`go.sum`, with `go mod download` followed by
  `go mod verify`; Go documents that `go mod verify` checks downloaded module
  content against its recorded hashes.
  [Go Modules Reference](https://go.dev/ref/mod#go-mod-verify)
- target `GOOS=windows`, `GOARCH=amd64`, and `CGO_ENABLED=0`; Go documents
  `GOOS`/`GOARCH` as the target OS/architecture controls for compilation, and
  the tagged upstream release already uses `CGO_ENABLED=0`.
  [Go command compile documentation](https://pkg.go.dev/cmd/go#hdr-Compile_packages_and_dependencies),
  [upstream release configuration](https://git.b4mad.industries/agentic-forges/forgejo-mcp/raw/tag/v2.34.1/.goreleaser.yml)
- release-equivalent flags: `-trimpath`, `-s -w`, and
  `-X main.Version=2.34.1`. The upstream Makefile injects `main.Version`,
  while the tagged entry point exposes the version to the command package.
  [`Makefile`](https://git.b4mad.industries/agentic-forges/forgejo-mcp/raw/tag/v2.34.1/Makefile),
  [`main.go`](https://git.b4mad.industries/agentic-forges/forgejo-mcp/raw/tag/v2.34.1/main.go)

A direct Go build can produce the Windows target without a Windows-native
compiler when the selected Go toolchain supports the target; this is a build
recipe to validate in CI, not a result claimed by this research. The tagged
GoReleaser file does **not** establish that upstream has tested or shipped the
Windows target. The upstream source does provide a harmless early
`--version`/`-version` path that prints `forgejo-mcp <version>` without
requiring the Forgejo URL.
[`cmd/cmd.go`](https://git.b4mad.industries/agentic-forges/forgejo-mcp/raw/tag/v2.34.1/cmd/cmd.go)

## 2. Fresh Windows source-build viability

A source build is **not viable if installation simply assumes `go` is already
installed**. The upstream README's source-install path starts with `git clone`
and `go install`, so it presupposes a Go command and access to the module
sources.
[upstream installation instructions](https://git.b4mad.industries/agentic-forges/forgejo-mcp/raw/tag/v2.34.1/README.md)

Go's automatic toolchain switching does not remove that bootstrap requirement:
Go documents that the `go` command may find or download a newer toolchain based
on `go.mod`, but a machine with no Go command cannot invoke this mechanism.
[Go toolchains](https://go.dev/doc/toolchain)
If DSH chooses source compilation, its installer must first obtain an exact
official Windows Go archive (or vendor one), validate the archive against the
SHA-256 published by the official Go download metadata, and use that private
`go.exe`; the official download page publishes Windows archives and SHA-256
checksums.
[official Go downloads](https://go.dev/dl/)
The installer must also obtain the pinned source and module dependencies, or
ship a verified source/dependency cache; otherwise the build still depends on
network access and module services. Go documents both module download and the
module checksum mechanism.
[Go Modules Reference](https://go.dev/ref/mod#authenticating)

Building Go itself from source is not a minimal installer bootstrap: Go's
official source-install documentation requires a bootstrap toolchain.
[Go source installation](https://go.dev/doc/install/source)

## 3. Delivery designs

| Design | Provenance and install behavior | Fully automatic on fresh Windows with no operator-provided executable or Go? |
|---|---|---|
| **A. Vendor a pinned `forgejo-mcp.exe` in the DSH Release ZIP** | DSH owns the Windows build and should ship a manifest containing upstream tag/commit, exact Go version, build flags, dependency-verification result, executable SHA-256, and expected version. The installer verifies the file before use. This avoids a Go runtime and network dependency at install time, but makes DSH responsible for producing, reviewing, and updating a Windows artifact. | **Yes.** The executable is supplied by the DSH release, not by the operator. |
| **B. Download a pinned immutable upstream artifact and validate SHA-256** | The upstream release provides checksums and a signature, but `v2.34.1` provides no Windows artifact, so this design is not presently available for the requested upstream executable. A DSH-hosted Windows artifact would become a variant of A, with DSH hosting and provenance responsibility. | **No, using the current upstream release. Yes only if a future upstream Windows asset exists or DSH supplies its own artifact.** |
| **C. Obtain a pinned Go toolchain and build a pinned source revision** | The installer downloads and validates an official Go Windows archive, obtains the verified upstream tag/source, verifies modules with `go.sum`/`go mod verify`, cross-builds with fixed target and flags, then hashes and probes the result. It has the clearest source provenance, but adds bootstrap downloads, build time, network/cache policy, and a native Windows build-validation obligation. | **Yes, technically, if DSH automatically obtains the pinned Go toolchain and all source/dependency inputs. No if “source build” means invoking a pre-existing `go`.** |

The release's existing signed checksum file is useful provenance for the assets
that actually exist; it cannot authenticate a nonexistent Windows asset.
[checksums](https://git.b4mad.industries/agentic-forges/forgejo-mcp/releases/download/v2.34.1/forgejo-mcp_2.34.1_checksums.txt),
[checksum signature](https://git.b4mad.industries/agentic-forges/forgejo-mcp/releases/download/v2.34.1/forgejo-mcp_2.34.1_checksums.txt.sig)

## 4. Smallest credible recommendation

For this Windows-first repository, choose **A for the first fully automatic
install**: build and vendor one pinned `forgejo-mcp.exe` in the DSH Release
ZIP. Pin `v2.34.1` and commit `223874f...` (or a later upstream release only
after repeating this check). Keep the build recipe and provenance manifest
next to the release process, rather than asking end users to install Go.

The installer/doctor must, at minimum:

1. verify the executable's SHA-256 against the release manifest;
2. verify the expected upstream version and run
   `forgejo-mcp.exe --version` (the source's harmless version path is suitable);
3. fail closed on hash/version/probe mismatch and report the exact operation;
4. retain the source tag/commit, Go version, target, flags, dependency
   verification, and artifact hash as release evidence.

C is a credible fallback if release-size or binary-maintenance constraints make
A unacceptable, but it should be implemented as an explicit bootstrap pipeline,
not as an implicit `go install`. B should be reconsidered only when the
upstream release metadata contains a Windows asset and a corresponding signed
checksum entry.

## Confirmed facts vs. assumptions

**Confirmed:** the upstream `v2.34.1` release metadata has no Windows asset; its
GoReleaser target list is Linux/Darwin only; the source requires Go `1.25.5`;
`go.mod`/`go.sum` provide the dependency inputs; and the source implements a
non-network `--version` path. Sources are linked above.

**Assumptions requiring a native build gate:** that the tagged source compiles
for `windows/amd64` with `CGO_ENABLED=0`; that the resulting MCP server's full
stdio behavior is acceptable to DSH; and that future upstream releases preserve
these CLI/build properties. No binary was downloaded or executed here, so
those are deliberately unverified.
