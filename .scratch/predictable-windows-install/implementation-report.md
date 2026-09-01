# Predictable Windows install implementation report

Date: 2026-09-01
Branch: `predictable-windows-install`
Fixed point: `ad5612bb8fd4695a75782f92467674644072185f` (`ad5612b`)

## Outcome

The complete predictable Windows installation spec and tickets 01–07 are implemented. The first and second review-fix batches close the remaining public-contract, release-build, receipt, capacity, renderer, installer-wrapper, diagnostics, credential, and native-gate findings. All tickets remain `Status: complete`.

## Review iteration and commits

- `585ed53` — `feat(windows-install): make release installation predictable` (whole-spec implementation).
- `1b2c517` — `fix(windows-install): close whole-spec review gaps` (release-owned npm manifests/locks with target `npm ci`, mandatory fresh installer compilation/inspection, removal of target-runtime Bun compatibility seams, deterministic TTY/Explorer handling, strict receipt layout, capacity evidence, version separation, redaction, named public contracts, and test/ticket updates).
- `8a272d5` — `fix(windows-install): assert timing capacity evidence` (native gate checks the product timing field `headroomBytes`).
- `a74a15f` — `fix(windows-install): retry interrupted lock acquisition` (ordinary concurrent stale-lock seam retries the narrow mkdir/owner-file race without leaving a child or lock owner behind).
- `a3720b6` — `fix(windows-install): close second review gaps` (receipt failures enter the session/evidence boundary, npm/package-manager credentials are centrally scrubbed/redacted, four inline public contracts are named, and receipt-backed paths reject conflicting explicit roots).

The first review delta through `a74a15f` was 509 additions and 280 deletions (789 changed lines). The second review commit adds 143 and deletes 29 (172 changed lines); the cumulative review diff from `585ed53` to `HEAD` is 647 additions and 304 deletions (951 changed lines). The original implementation's fixed-point diff remains 2,939 changed non-generated lines. Generated runtime npm lockfiles are release-owned inputs and are intentionally excluded from the source LOC count.

## Contract coverage

- Release ZIP builds always compile a fresh Bun Windows x64 `installer.exe`, write measured compiler/native-artifact evidence, archive it, and inspect the archive on every host and test seam. ZIP tests use a calibrated 180-second timeout and await child-tree termination.
- Runtime `package.json`/`package-lock.json` pairs are copied from `runtime-manifests/` and installed with `npm ci`; the target never creates a lock from the registry. Target runtime options/readers/shims contain no Bun compatibility fields. Remaining Bun references are build-time Release compilation or Electrobun-host-specific data only.
- Automatic renderer selection uses the actual `stdout.isTTY`; redirected stdout selects plain mode and reports required/available capacity. NDJSON, plain, and Clack share the same session events. `Install.cmd` pauses only after a deterministic Explorer-process ancestry check; terminal and redirected invocations never pause.
- A no-argument compiled installer resolves its Release root from `dirname(process.execPath)`. The installation layout always uses the distinct `installationRoot/program` child. Existing malformed, invalid, or conflicting receipts fail closed instead of starting a second install.
- Capacity uses the product-owned reserve `INSTALLATION_STAGING_HEADROOM_BYTES = 536870912` (512 MiB) with the recorded formula `requiredBytes = measuredReleasePayloadBytes + headroomBytes` and basis `Measured extracted Release payload plus the product-owned 512 MiB staging/rollback reserve.` Destination validation, session output, timing evidence, and Release evidence consume these same measured values, including native installer bytes.
- Timing JSON records `productVersion: 0.1.0` and `runtimeVersion: 0.1.1-rc.2` separately. Compiler and child diagnostics are bounded and redacted before surfacing. New public return/options seams use named exported interfaces; unused compatibility seams and fields were removed.
- Receipt inspection is nonthrowing until the install session and evidence writer have started; malformed/unreadable receipts then produce one failed terminal session event, a redacted diagnostic log, and an atomically committed failed timing record. Receipt-backed path helpers honor a valid receipt even when an explicit root is supplied and reject conflicts.
- `withoutCredentials` and `redactSensitive` centrally recognize NPM_TOKEN, NODE_AUTH_TOKEN, GITHUB_TOKEN, GITLAB_TOKEN, npm_config__auth, and registry `_auth`/`_authToken` forms. Captured child output is redacted before it reaches install logs.
- The Clack pin is `@clack/prompts@1.7.0`. npm reports `1.7.0` as `latest`; its documented engine is Node `>=20.12.0` and its repository is the maintained upstream Clack repository. The product's Node 22 floor satisfies that documented range.

## Verification

Ordinary checks:

- `bun run check` — passed (`tsc --noEmit`).
- `git diff --check` — passed.
- `bun test tests/phase7.test.ts tests/phase10.test.ts` — **65 pass, 0 fail**, 576 expect calls, 2 files, 19.03s. This covers malformed-receipt event/evidence output, receipt-root conflict handling, centralized package-manager credential scrubbing, and captured install-log redaction.
- `bun test tests/phase1.test.ts tests/phase7.test.ts tests/phase11.test.ts` — **88 pass, 0 fail**, 513 expect calls, 3 files, 19.09s. This includes redirected-renderer/installer-root/receipt/version coverage, mandatory real Release ZIP builds, and the 180-second ZIP timeout seam.
- `bun test` — **147 pass, 0 fail**, 1,058 expect calls, 8 files, 28.06s.
- Clack research: `npm view @clack/prompts version dist-tags --json` returned `1.7.0`/`latest`; `npm view @clack/prompts@1.7.0 version engines repository --json` returned Node `>=20.12.0` and the upstream repository.

Authorized disposable native Windows fresh-install/repair gate:

- Command: `nuc-powershell /tmp/dsh-run-native-gate.ps1` (final successful run from the first review batch; intentionally not rerun for this deterministic second review batch).
- Preflight announced 5–8 minutes, disposable Release ZIP/extraction/install/program/local-state/DSH-home/log/shortcut/npm-cache roots, npm registry plus loopback DSH Web/MCP services, and no WinGet/system-prerequisite mutation.
- Result: `NATIVE_GATE_EXIT=0`; `{ "ok": true, "gate": "phase7-windows-installed", "dsh": "0.1.1-rc.2", "durationMs": 323383 }` (about 5m23s). The final disposable gate root and artifacts were removed by cleanup.
- Native evidence covered a fresh Release compile and inspection, standalone/wrapper help, Explorer exit 0 versus terminal exit 1, no Node/Bun on the target PATH before install, receipt-backed fresh install and repair, Node/npm runtimes, app-owned pnpm/profile, desktop host, shortcut, timing/log evidence, and Agent process/tool evidence. Both timing records carried measured capacity and distinct product/runtime versions.
- External services were limited to normal npm registry access and local loopback probes. The host used already-installed Node 24.18.1, Python 3.13.15, PowerShell 7.6.5, Git 2.51.0, Coreutils, and ImageMagick. No WinGet invocation or system-prerequisite mutation occurred. The true clean-machine prerequisite-install VM gate remains explicitly unrun and separately unverified.

Two whole-spec review passes were completed: the first identified the initial
cross-cutting gaps, and the second verified that batch while identifying the
four local gaps closed by `a3720b6`. The final delta received focused
verification because it did not change the installation method or native
success path. Deployment was not performed, per the request.
