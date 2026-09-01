# Windows install recovery implementation report

Date: 2026-09-01

Branch: `windows-install-recovery`
Fixed point: `f5f5861` (`main`)

## Outcome

The complete Windows install recovery spec and tickets 01–04 are implemented,
including the deterministic review-fix batch. The installed program tree is
self-describing, the packaged sidecar locates its program root from its own
entrypoint, startup failures persist only bounded structured summaries (with
standard Authorization Bearer and Basic values excluded), Release packaging
enforces fresh maintenance artifacts and coherent canonical sidecar
provenance, and interrupted runs leave useful evidence. Product-launch errors
never write their original messages or raw child output to `launcher.log`; the
direct stderr path remains the only place for bounded redacted details. This
local review-fix turn did not run deployment or the live clean-machine gate.

## Ticket coverage

### 01 — Make interrupted installation evidence useful

- `InstallRunEvidence.start()` now writes a complete redacted
  `install-run-started` JSON header before lock acquisition or install phases.
- Existing owner-PID stale-lock reclamation and narrow acquisition-race
  handling remain in place, so a dead owner is reclaimed without waiting for
  the full timeout.
- The implementation does not attempt to synthesize terminal timing data after
  an uncatchable process termination.

### 02 — Install a complete maintenance program tree

- Release source entries remain separate from generated archive entries and the
  installed-program contract.
- Packaging creates `installer.exe` and `installer-build.json`; fresh,
  upgrade, and repair installs copy both into the selected program root.
- Generated artifacts are required to be regular, non-empty files and the
  receipt is committed only after the installed maintenance contract verifies.
- Disposable extracted-Release coverage asserts both files remain present
  after initial installation and repair.

### 03 — Launch from any selected installation root

- The production sidecar derives `<program>` from its packaged entrypoint under
  `desktop-host/Resources/app/payload/sidecar`; it no longer uses the removed
  installation-root environment fallback.
- Tests can inject only the packaged entrypoint and a test-owned local-state
  root. Startup and nonzero-child failures append a timestamped stable event
  with operation/category and a bounded safe summary to `logs/launcher.log`;
  load failures may include the expected installed module path and child
  failures may include only a numeric exit status.
- Arbitrary caught error messages and raw child output are never persisted;
  diagnostic write failures are swallowed so the original startup error or
  exit behavior is preserved. The existing stderr path retains bounded
  redacted details when the process is run directly.

### 04 — Reject stale desktop-host product payloads

- Adapter staging computes SHA-256 digests for `src/electrobun-sidecar.ts` and
  the bundled sidecar, exposes them in the stage result, and writes one
  machine-readable `adapter-provenance.json` handoff. The generated generic
  `product.manifest.ts` does not duplicate that handoff.
- The canonical `desktop-host.json` contract now accepts only
  `manifest.sidecarProvenance` with exactly `schemaVersion`,
  `adapterSourceSha256`, and `sidecarSha256`; aliases, extra fields, and
  malformed values are rejected.
- Release verification independently hashes the current source and packaged
  sidecar and rejects missing, malformed, stale-source, tampered-sidecar, and
  pre-provenance payloads before copy or archive.

The direct-install tests share one test-owned `tests/fixtures/release-fixture.ts`
module with synthetic non-empty maintenance artifacts; no production
source-checkout bypass remains.

## Verification evidence

- Focused recovery/host suite (`tests/phase7.test.ts`,
  `tests/phase13.test.ts`, `tests/phase14.test.ts`, and
  `tests/phase15.test.ts`) — **78 pass, 0 fail**, 496 `expect()` calls.
- `bun test` — **155 pass, 0 fail**, 1,115 `expect()` calls across 9 files.
- `bun run check` — passed (`tsc --noEmit`).
- `git diff --check` — passed.

The tests use disposable roots and injected runners/writers; they do not read
or mutate live installation state, credentials, installed executables, or
production services. No expensive native acceptance gate, deployment, or code
review was performed.

## Changed-LOC accounting

Additions plus deletions against fixed point `f5f5861`, excluding generated
files and lockfiles (the report itself and ignored ticket metadata are not
included):

| Category | Changed LOC |
| --- | ---: |
| Product code and scripts | 515 |
| Tests | 462 |
| Documentation and machine-readable contract updates | 58 |
| **Total** | **1,035** (945 additions + 90 deletions) |

The total is 355 lines above the 395–680 estimate. The second review-fix turn
adds the structured-diagnostic boundary contract and raw-output regression,
the explicit missing-launcher-path case, and the shared fixture extraction.
Counts are additions plus deletions against `f5f5861`, excluding this report,
ignored ticket metadata, generated files, and lockfiles.
