# Repository Guidelines

## Project Structure & Module Organization

Core TypeScript lives in `src/`. Windows entrypoints are the root PowerShell and `.cmd` files. Agent presets and domain skills live under `presets/`; release, acceptance, and manual-gate utilities live under `scripts/`. Bun tests are grouped by delivery phase in `tests/`, with test-owned fixtures below `tests/fixtures/`. Product documentation is in `docs/`; local specs and ticket state are tracked under `.scratch/`.

## Build, Test, and Development Commands

- `bun test`: run the ordinary, fast test suite.
- `bun test tests/phase8.test.ts`: run one focused test file.
- `bun run check`: run TypeScript checking without emitting files.
- `bun run release:zip -- <path>`: build a Windows Release ZIP without overwriting an existing archive.
- `bun run doctor`: inspect the configured local installation.
- `nuc-powershell <script.ps1>`: on the configured host, run native Windows automation through `ssh nuc` with the real PowerShell 7 executable; prefer it to inline SSH quoting.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation, semicolons, single quotes, and explicit exported interfaces for public contracts. Keep modules focused on one product capability. Use `camelCase` for values/functions, `PascalCase` for types/classes, and kebab-case filenames. Prefer precise error messages that preserve the failing operation and never include credentials.

## Testing Guidelines

Tests use `bun:test`. Name test files `phase<N>.test.ts` and test observable behavior through disposable roots, fixtures, and injected command runners. Tests must never read or mutate live DSH state, credentials, projects, installed executables, or production services. Run the smallest focused test first, then `bun test`, `bun run check`, and `git diff --check` before committing.

### Expensive Acceptance Gates

Run `phase*:real`, simulated fresh/disposable installations, native Windows install or repair gates, and external runtime/provider downloads only when the user explicitly requests that exact class of test in the current conversation. “Verify” or “continue” alone is not authorization. Before an expensive gate, state what it provisions, expected duration, and external services used.

## Commit & Pull Request Guidelines

Use scoped Conventional Commits: `feat(scope): description`, `fix(scope): description`, `refactor(scope): description`, or `chore(scope): description`. Review `git diff --cached` before committing. PRs should summarize user-visible behavior, list focused verification, identify unverified native Windows gates, and include screenshots only for visible UI changes. Keep hardware-dependent PRs Draft until their required evidence exists.

## Security & Configuration

Keep API keys outside projects and Git. Redact subprocess output before surfacing diagnostics. Use `og` rather than raw `git push` for guarded remote operations.
