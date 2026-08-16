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
npm run test:coverage     # Vitest + a coverage floor CI enforces (see vitest.config.ts)
npm run test:integration  # real VS Code extension host (downloads VS Code once)
```

**`test:integration` does NOT rebuild the bundle.** It runs `compile-tests` (tsc → `out/`) and the
extension host loads `main` = `dist/extension.js`. So after changing anything under `src/` that the
*extension* runs (a provider, a registration, a command), run `npm run compile` first or the host
under test is your PREVIOUS build — a fix appears not to work, or a bug appears already fixed. Only
the test files themselves come from `out/`.

`npm test` = unit + integration. CI ([.github/workflows/ci.yml](.github/workflows/ci.yml))
runs lint + compile + `test:coverage` + `test:integration:coverage` on every PR, plus the UI tests.
**Publishing to the Marketplace is gated on these passing**
([.github/workflows/main.yml](.github/workflows/main.yml), triggered by a push to `main`) —
never merge to `main` red.

**Two coverage numbers, both regression guards, neither a target.** They measure opposite
halves: unit coverage is high on extracted pure modules and necessarily ~0 on everything
`vscode`-tangled, and the extension host is the only thing that executes the tangled half.
`npm run test:integration:coverage` reports the host's coverage of `src/**` via
[scripts/integrationCoverage.mjs](scripts/integrationCoverage.mjs) (the floor lives there;
`vitest.config.ts` holds the unit one). Ratchet both up as tests land — never down. Note the
integration number's *statement* percentage flatters the suite, because every bundled module's
top level runs at require time; the FUNCTIONS percentage, and the "no function ever entered"
count the script prints, are the honest read.

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

**End-to-end lifecycle suites** (see [TESTING.md](TESTING.md#end-to-end-lifecycle-suites)):
`npm run test:live` runs headless command-level lifecycle tests
(`test/live/webresourceScaffoldLifecycle.spec.ts`, `pluginLifecycle.spec.ts`) that drive
scaffold→restore→typings→build→deploy with no UI — the reliable way to verify the two flows.

`npm run test:e2e` drives the **literal VS Code UI** (`src/ui-test/e2e/*.e2e.ts`) via
Selenium/ExTester against the live test env. **Run it only in an isolated Windows VM**
(`scripts/setup-vm-e2e.ps1`) — on a shared desktop Selenium's keystrokes get corrupted by
whatever else has focus. Key facts:
- It goes through **`scripts/runE2E.mjs`** (not a bare `extest`): the launcher **seeds an
  MSAL token cache** (`scripts/preAcquireInteractiveCache.mjs`, ROPC with the MFA-exempt
  `DVPT_TEST_USERNAME`/`PASSWORD`) and sets `DVPT_TEST_MSAL_CACHE_FILE`, so the **interactive
  (OAuth) suites run for real** instead of skipping — the extension's cache plugin then signs
  in silently (there's no browser to drive inside ExTester). Best-effort: no creds → those
  suites skip and the service-principal suites still run.
- Suites: `pluginAcceptance`, `pluginInteractiveLifecycle`,
  `webresourceInteractiveLifecycle`, and the log-gated 8-step `webresourceComprehensive`
  (init → typings → class+test → build → deploy → register form events → live-app
  deployed-code check → Debug Web Resources hot-reload). Steps are **gated on the extension's
  own log line** via `expectOutput()` — a wrong/missing line stops the run.
- **VM hygiene matters (8GB box):** reap orphaned `webpack --watch` node procs, ExTester
  `Code.exe` (under `%TEMP%\test-resources`), and `msedge` between runs — they accumulate and
  starve the host (a mid-suite `ECONNREFUSED` to the webdriver = OOM). The debug feature
  tree-kills its watcher on stop; the comprehensive suite reaps stragglers in `before`. In a
  very long session, background full-e2e runs can get killed ~10 min in — run subsets or start
  fresh. Never kill the user's own VS Code (`AppData\Local\Programs\Microsoft VS Code`).
- **Authoring UI e2e steps — two traps that cost a run each:** (1) Gate each step on the command's
  FINAL signal (its last log line, e.g. `[Components] N components discovered`), NOT an intermediate
  artifact like an npm/paket lockfile — those are written mid-command, so the test proceeds while the
  command is still running and the *next* command overlaps it (interleaved output, a busy UI). (2)
  Select quick-pick items by keyboard (type-to-filter + Enter via `answerText`), not a coordinate
  click — closing all editors reveals the empty-editor watermark whose `<p>` hints sit over the
  quick-pick rows and intercept clicks (`ElementClickInterceptedError`). Also: file-existence asserts
  pass even when a command errored *after* scaffolding, so assert no "resulted in an error"
  notification too.

## Changelog: two files

- **[CHANGELOG-prerelease.md](CHANGELOG-prerelease.md)** accumulates one section per
  **pre-release** version — that's where a normal PR's entry goes.
- **[CHANGELOG.md](CHANGELOG.md)** only gains a section per **full release**, and it's the one
  the Marketplace shows. At a full release run
  `node scripts/rollupChangelog.mjs <version> --summary "…"`: it folds every accumulated
  pre-release section under one `## <version>` heading (demoted to `###`, nothing lost) and
  resets the pre-release file for the next cycle. `--dry-run` prints what it would move.

## Preview features (release gating)

Unverified features ship **off**, behind `dataverse-powertools.previewFeatures` (default
false; a checkbox sits next to *Show Log* in the panel footer). The list lives in ONE pure
module — [src/general/previewFeatures.ts](src/general/previewFeatures.ts) — and gates four
surfaces, all of which must agree:

1. the panel (project cards, card blocks, secondary/overflow buttons) via `PanelState.previewFeatures`,
2. the command palette, via `&& config.dataverse-powertools.previewFeatures` on each command's
   `enablement` in package.json (parity is enforced by `previewFeatures.spec.ts`, in both directions),
3. the Add Component / project-type quick picks (`visibleProjectTypes`),
4. anything else conditional in a feature module (e.g. the per-step Profile CodeLens).

Currently gated, each with its manual-test sign-off issue (also on the descriptor as
`manualTestIssue`): **Azure Functions** (whole project type,
[#223](https://github.com/pete-mc/dataverse-powertools/issues/223)), **plug-in debugging**
(profiler capture/download/replay, [#224](https://github.com/pete-mc/dataverse-powertools/issues/224))
and **Custom APIs** ([#225](https://github.com/pete-mc/dataverse-powertools/issues/225)). The
e2e/UI suites turn the flag ON via [test/ui-settings.json](test/ui-settings.json), so they keep
covering the gated flows. To un-gate a feature once its issue is signed off, delete its entry
from `PREVIEW_FEATURES` and drop the `config.…previewFeatures` clause from its commands in
package.json — the parity test tells you if you only did half.

## Traps specific to this repo

- **Commands are declared in two places.** A new command needs both runtime
  registration (in the feature module's `initialise*`) **and** a `contributes`
  entry in [package.json](package.json). Menu/view visibility uses `when` clauses
  bound to context keys (`dataverse-powertools.showLoaded`, `.isPlugin`, etc.) that
  are set via `vscode.commands.executeCommand("setContext", ...)`. Change one, check
  the other, or the UI silently desyncs.
- **Every Dataverse command must work under BOTH auth types.** A connection is either a
  service principal (client id/secret + tenant) **or** interactive (OAuth). Interactive sets
  **no tenantId** — so never gate a command on `projectSettings.tenantId` / `dataverse.tenantId`.
  Gate on the live connection instead (`canCallDataverseApi({ organizationUrl, isValid })` in
  [src/general/dataverse/connectionReady.ts](src/general/dataverse/connectionReady.ts)); the
  access token authorizes the call, not the tenant. This class of bug shipped three times
  (#91 typings, #90/register form events under interactive). The e2e's `*InteractiveLifecycle`
  suites exist to catch it — if you touch a Dataverse path, they must stay green.
- **A per-type `initialise*` runs ONCE PER COMPONENT — never register global singletons there.**
  With multi-component workspaces (#47), two components of the *same type* both run that type's
  `initialise*`. Anything registered there with a fixed identity collides on the second one:
  a `vscode.tests.createTestController(id, …)` throws "duplicate controller with ID", a
  `registerCommand(id, …)` throws "command … already exists". Fixes: TestController ids are
  scoped per component (`scopedTestControllerId` + a dispose-on-reinit registry, in
  [pluginTestController.ts](src/plugins/pluginTestController.ts)/[webresourceTestController.ts](src/webresources/webresourceTestController.ts));
  commands and CodeLens providers register ONCE globally in [extension.ts](src/extension.ts) /
  `registerAllComponentCommands` — never in an `initialise*`. **Both of these shipped in 0.8.4**
  and were caught by the two-of-each e2e (below), not by any unit test.
- **A scoped component's `writeSettings()` must not persist INHERITED fields.** Discovery
  ([resolveComponents](src/components/discovery.ts)) merges the root's connection/tenant/prefix/env
  into each subfolder component's in-memory settings for a complete view. `writeSettings` strips
  `activeComponent.inheritedFields` before writing so they aren't baked into the component's file —
  otherwise the component gains its own `connectionString`, which makes `resolveComponents` treat it
  as self-contained and it STOPS tracking the root's connection changes. Any command that writes a
  subfolder component's settings (e.g. Switch Output Mode) hits this path.
- **Two components of the same type is a distinct test surface.** The three bugs above are invisible
  to unit tests and to a one-of-each e2e — the [blankRootComponents](src/ui-test/e2e/blankRootComponents.e2e.ts)
  suite now adds TWO of every type and asserts targeting + no error notification. Keep it green when
  touching any per-type `initialise*`, discovery, or `runForComponent`.
- **Build/tests run the project's LOCAL bins via `npx`, never a bare `webpack`/`jest`.** The
  template installs webpack/jest/ts-loader as devDependencies; a bare `webpack` only resolves a
  *global* install and fails ("'webpack' is not recognized") where there isn't one. See
  `WEBRESOURCE_BUILD_COMMAND` in [src/webresources/webpackBuild.ts](src/webresources/webpackBuild.ts).
  The production webpack build compiles against **`tsconfig.build.json`** (`types: []`, tests
  excluded) so it doesn't need `@types/jest` or type-check Jest tests — don't reintroduce that
  coupling. `dotnet` is a real exe (spawn directly); `npx`/`jest`/`webpack`/`pac` are `.cmd`
  shims on Windows — go through `cmd.exe` or `npx` (the `spawn EINVAL` trap; see
  [src/general/pac.ts](src/general/pac.ts)).
- **System requirements are `dotnet` / `node` / `pac` only.** webpack/webpack-cli/jest/typescript
  are per-project local devDeps now, not globals ([src/general/systemRequirements.ts](src/general/systemRequirements.ts)).
- **`src/plugins_old/` is GONE** (removed in 1.0.3, #228). Legacy template-v2 projects
  (`templateversion < 3`) now get a migration notice and run the current `src/plugins/` path
  best-effort; there is no second plugin code path any more. The only legacy-aware bits left are
  that notice in [activation.ts](src/projectTypes/activation.ts) and the `isPluginV3` context key
  (which still hides the v3-only earlybound surfaces).
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
- **Webresource typings are cross-platform now** (#78/#91): a bundled **net8** build of
  XrmDefinitelyTyped run via `dotnet`, in `tools/xrmdefinitelytyped/`, authenticated with the
  extension's own access token via the `DVPT_TOKEN` env var — so it works on any OS and under
  both service-principal and interactive auth (no client secret, no Windows-only `.exe`). The
  tool isn't committed; `scripts/fetchTypingsTool.mjs` fetches it into `tools/` on install /
  prepublish. Pure arg builders live in
  [generateTypings.ts](src/webresources/generateTypings.ts) (`buildTypingsArgs`, unit-tested).
- **Profiler capture is cross-platform now** (#264): `Profile next run` / the per-step Profile
  CodeLens used to shell out to a bundled **net48** tool (`profiler-tool/`) because PRT's
  `ProfilerManagementUtility.EnablePlugin` takes a .NET-Framework `CrmServiceClient`. Decompiling
  that method showed it is only ordinary SDK requests, so it now lives in
  [profilerSteps.ts](src/general/dataverse/profilerSteps.ts) as Web API calls — the tool, its build
  script and the `windows-latest` pin on the publish job are all gone. **The `configuration` blob is
  a contract with the profiler's own server-side plug-in** (a `DataContractSerializer` over
  `[DataContract(Name = "Configuration", Namespace = "")]`): members are ALPHABETICAL and unset ones
  are `i:nil`, and `profilerSteps.spec.ts` pins the exact bytes against a real serializer's output.
  Don't "tidy" that emitter. Enable also MOVES the step's images to the clone and DISABLES the
  original — miss either and the profiler silently never fires.
- **Still Windows-only:** the e2e browser automation (drives Edge on the Windows VM) and the
  net462 replay *runner* in the capture live spec (the product's own replay goes through the
  user's test project and works anywhere). With `plugins_old/` gone (#228) nothing else pins
  `spkl.exe`/`sn.exe`.

## Test Explorer (native Testing API, #84)

Plugin (.NET) and web-resource (Jest) tests surface in VS Code's Testing side bar via a
`TestController` created per COMPONENT in the feature `initialise*`
([src/plugins/pluginTestController.ts](src/plugins/pluginTestController.ts),
[src/webresources/webresourceTestController.ts](src/webresources/webresourceTestController.ts)),
disposed through `context.subscriptions`. The controller id is scoped per component
(`scopedTestControllerId`) so two same-type components don't collide on a duplicate id (see the
multi-component trap above), and a per-id registry disposes the stale controller on re-discovery.
The result/discovery **parsers are pure and
unit-tested** — `parseTrx`, `parseDotnetListTests` (plugins), `parseJestJson` (web resources);
keep parsing logic there, not in the controllers. Plugins run `dotnet test --logger trx`
(+ `--filter`); web resources run the local `npx jest --json --testLocationInResults`.

**Continuous run (watch), web resources only** (#232): the Jest Run profile sets
`supportsContinuousRun`, so VS Code's own watch toggle drives it — no setting of ours, and the
token it hands us disposes the file watcher when the user turns it off. It re-runs through the
ORDINARY one-shot jest path per change (never `jest --watch`): a long-lived watcher child is the
documented way to starve the e2e VM. Which tests a change re-runs is a pure, unit-tested decision
in [continuousRun.ts](src/webresources/continuousRun.ts) — a test file runs itself, a source file
runs them all (we don't have Jest's dependency graph, and guessing would skip the tests that matter).

## GitHub issues & wiki

- **Issues/PRs:** use the `gh` CLI (authenticated). The wiki is a separate git repo
  cloned as a sibling at `../dataverse-powertools.wiki`, granted to Claude via
  `permissions.additionalDirectories` in `.claude/settings.local.json` — edit it in
  place and push to its own `…wiki.git` remote.

## Housekeeping still open (see the session that set up this foundation)

- ~15 stale Dependabot branches on the remote need triage.
- Wiki likely needs updating for the spkl→`pac` and cross-platform changes. PCF, Custom API,
  LM Tools and multi-component have no wiki/README coverage at all
  ([#233](https://github.com/pete-mc/dataverse-powertools/issues/233)).
- `src/plugins_old/` — DONE, removed in 1.0.3 (#228).
