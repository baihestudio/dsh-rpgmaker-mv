# Windows install recovery implementation report

Date: 2026-09-01

Branch: `windows-install-recovery`
Fixed point: `f5f5861` (`main`)

## Outcome

The complete Windows install recovery spec and tickets 01–04 are implemented.
The installed program tree is self-describing, the packaged sidecar locates its
program root from its own entrypoint, startup failures are bounded and
redacted, Release packaging enforces fresh maintenance artifacts and coherent
sidecar provenance, and interrupted runs leave useful evidence. Code review,
deployment, and the live clean-machine gate were not run, as requested.

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
  with a bounded credential-redacted error to `logs/launcher.log`.
- Diagnostic write failures are swallowed so the original startup error or exit
  behavior is preserved.

### 04 — Reject stale desktop-host product payloads

- Adapter staging computes SHA-256 digests for `src/electrobun-sidecar.ts` and
  the bundled sidecar, exposes them in the stage result, and writes
  `adapter-provenance.json` plus a generated `sidecarProvenance` export.
- The canonical `desktop-host.json` contract now requires schema-versioned
  sidecar provenance with both digests.
- Release verification independently hashes the current source and packaged
  sidecar and rejects missing, malformed, stale-source, tampered-sidecar, and
  pre-provenance payloads before copy or archive.

## Verification evidence

- `bun test` — **151 pass, 0 fail**, 1,085 `expect()` calls across 9 files.
- Focused recovery/host suite (`tests/phase13.test.ts`,
  `tests/phase14.test.ts`, `tests/phase15.test.ts`, and `tests/phase7.test.ts`)
  — **74 pass, 0 fail**, 470 `expect()` calls.
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
| Product code and scripts | 444 |
| Tests | 249 |
| Documentation and machine-readable contract updates | 62 |
| **Total** | **755** (680 additions + 75 deletions) |

The total is 75 lines above the 395–680 estimate. The variance is concentrated
in product code: strict provenance parsing/hash checks, sidecar diagnostic
redaction/write-failure handling, and transaction-boundary maintenance checks
needed explicit failure paths rather than a compatibility shim. Test changes
remain within the estimated 220–360 range; documentation is only two lines
above its estimate.
