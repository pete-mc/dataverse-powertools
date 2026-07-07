# CLAUDE.md

Working notes for Claude Code in this repo. Architecture and conventions live in
[AGENTS.md](AGENTS.md) — read that for *what the code is*. This file is *how to
work in it*: the verify loop, the test layers, and the traps.

## What this is

`dataverse-powertools` — a VS Code extension (TypeScript, webpack-bundled) for
Dataverse / Dynamics 365 / Power Platform development. Entry point:
[src/extension.ts](src/extension.ts). Runtime state hangs off
`DataversePowerToolsContext` ([src/context.ts](src/context.ts)).

## The verify loop — run these before saying a change works

```
npm run lint              # eslint (must be clean)
npm run compile           # webpack bundle -> dist/ (must succeed)
npm run test:unit         # Vitest, fast, no editor  (~<1s)
npm run test:integration  # real VS Code extension host (downloads VS Code once)
```

`npm test` = unit + integration. CI ([.github/workflows/ci.yml](.github/workflows/ci.yml))
runs all of this on every PR, plus the UI tests. **Publishing to the Marketplace
is gated on these passing** ([.github/workflows/main.yml](.github/workflows/main.yml)) —
never merge to `main` red.

## Three test layers — pick the cheapest that can catch the bug

1. **Unit (Vitest)** — `src/**/*.spec.ts`. For pure logic. Fastest. The `vscode`
   module is aliased to a mock ([test/vscode.mock.ts](test/vscode.mock.ts)).
   **Prefer extracting pure logic into a `vscode`-free module and unit-testing it**
   over reaching for the mock — most of this codebase is currently untestable
   because logic is tangled with the `vscode` API. Untangling it *is* the refactor.
2. **Integration (`@vscode/test-cli`)** — `src/test/suite/**/*.test.ts`, mocha `tdd`
   (`suite`/`test`). Runs in a real extension host; use for "does this command /
   activation / context-key actually do X". Config: [.vscode-test.mjs](.vscode-test.mjs).
3. **UI (ExTester / Selenium)** — `src/ui-test/**/*.test.ts`, mocha `bdd`
   (`describe`/`it`). Drives the real VS Code UI (activity bar, tree views, context
   menus, welcome views) via page objects. Slowest; use only for genuinely
   UI-level flows the API can't assert. Run: `npm run test:ui`.

When adding tests, keep the naming/UI conventions distinct so the runners don't
cross-pick files: `.spec.ts` (unit) vs `.test.ts` under `test/suite` (integration)
vs `.test.ts` under `ui-test` (UI).

## Traps specific to this repo

- **Commands are declared in two places.** A new command needs both runtime
  registration (in the feature module's `initialise*`) **and** a `contributes`
  entry in [package.json](package.json). Menu/view visibility uses `when` clauses
  bound to context keys (`dataverse-powertools.showLoaded`, `.isPlugin`, etc.) that
  are set via `vscode.commands.executeCommand("setContext", ...)`. Change one, check
  the other, or the UI silently desyncs.
- **`src/plugins_old/` is deprecated** (template version < 3) but still wired for
  legacy projects. New work goes in `src/plugins/`. Don't add features to `_old`.
- **Dataverse HTTP calls belong in `src/general/dataverse/`**, not in feature files.
- **Secrets never go in `dataverse-powertools.json`** — client id/secret live in VS
  Code secret storage; the settings file holds the non-secret connection base.
- **`tsconfig.json` is scoped to `src/**`** and sets no `noEmitOnError`, so a tsc
  error can still emit stray `.js`. If you see stray compiled files at the repo
  root, that's why — delete them; they won't regenerate now that scope is fixed.
- **Publish package hygiene:** [.vscodeignore](.vscodeignore) excludes `samples/`,
  `originalTemplates/`, tests, and dev config from the shipped VSIX. If you add a
  new dev-only folder, add it there too or it bloats the published extension.

## Cross-platform status

The extension is being made OS-agnostic. Dataverse plugins *target* .NET Framework
4.6.2 (a sandbox-runtime constraint, moving to net48 ~Q4 2026), but that does **not**
require building on Windows — `dotnet build` compiles net462 on any OS, and the
modern plugin flow already shells out to `dotnet`/`pac`.

- **Never hand-concatenate paths.** Use `path.join` (or the helpers in
  [src/general/paths.ts](src/general/paths.ts)). The old `fsPath + "\\" + name` broke
  the whole extension off-Windows.
- **Solutions are cross-platform.** [src/solution](src/solution) now uses `pac`
  (`pac auth create` + `pac solution pack/unpack/export/import`) instead of `spkl.exe`.
  Config still comes from `spkl.json` (just a config file now — no spkl tool). Auth
  uses a single named pac profile, `dataverse-powertools`, recreated per run from the
  connection string's service principal. Pure arg builders live in
  [src/solution/pacArgs.ts](src/solution/pacArgs.ts) (unit-tested) — add/verify flags
  there against the pac reference.
- **Still Windows-only** (external binaries, not our code): webresource typings via
  `XrmDefinitelyTyped.exe` ([generateTypings.ts](src/webresources/generateTypings.ts)),
  and the deprecated `plugins_old/` path (still uses `spkl.exe`). Don't spend
  cross-platform effort on `plugins_old/`.

## GitHub issues & wiki

- **Issues/PRs:** use the `gh` CLI (authenticated). The wiki is a separate git repo
  cloned as a sibling at `../dataverse-powertools.wiki`, granted to Claude via
  `permissions.additionalDirectories` in `.claude/settings.local.json` — edit it in
  place and push to its own `…wiki.git` remote.

## Housekeeping still open (see the session that set up this foundation)

- ~15 stale Dependabot branches on the remote need triage.
- Decide whether `src/plugins_old/` can be removed.
- Wiki likely needs updating for the spkl→`pac` and cross-platform changes.
