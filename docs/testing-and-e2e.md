# Testing layers, e2e and Test Explorer

Reference moved out of AGENTS.md (rules and the verify loop stay there). See also [TESTING.md](../TESTING.md).

## Three test layers — pick the cheapest that can catch the bug

1. **Unit (Vitest)** — `src/**/*.spec.ts`. For pure logic. Fastest. The `vscode`
   module is aliased to a mock ([test/vscode.mock.ts](../test/vscode.mock.ts)).
   **Prefer extracting pure logic into a `vscode`-free module and unit-testing it**
   over reaching for the mock — most of this codebase is currently untestable
   because logic is tangled with the `vscode` API. Untangling it *is* the refactor.
2. **Integration (`@vscode/test-cli`)** — `src/test/suite/**/*.test.ts`, mocha `tdd`
   (`suite`/`test`). Runs in a real extension host; use for "does this command /
   activation / context-key actually do X". Config: [.vscode-test.mjs](../.vscode-test.mjs).
3. **UI (ExTester / Selenium)** — `src/ui-test/**/*.test.ts`, mocha `bdd`
   (`describe`/`it`). Drives the real VS Code UI (activity bar, tree views, context
   menus, welcome views) via page objects. Slowest; use only for genuinely
   UI-level flows the API can't assert. Run: `npm run test:ui`.

When adding tests, keep the naming/UI conventions distinct so the runners don't
cross-pick files: `.spec.ts` (unit) vs `.test.ts` under `test/suite` (integration)
vs `.test.ts` under `ui-test` (UI).

**End-to-end lifecycle suites** (see [TESTING.md](../TESTING.md#end-to-end-lifecycle-suites)):
`npm run test:live` runs headless command-level lifecycle tests
(`test/live/webresourceScaffoldLifecycle.spec.ts`, `pluginLifecycle.spec.ts`) that drive
scaffold→restore→typings→build→deploy with no UI — the reliable way to verify the two flows.

`npm run test:e2e` drives the **literal VS Code UI** (`src/ui-test/e2e/*.e2e.ts`) via
Selenium/ExTester against the live test env. Selenium types into whatever window has focus, so it
needs a display nothing else is using. **On Linux that is `xvfb`, not a VM: `npm run test:e2e:headless`**
(provision with `scripts/setup-linux-e2e.sh`). The Windows VM path (`scripts/setup-vm-e2e.ps1`)
still works but needs a dedicated machine. Two Linux-only ExTester bugs are patched on postinstall by
[scripts/patchExtester.mjs](../scripts/patchExtester.mjs) — `openResources()` silently doing nothing
(#268) and the ChromeDriver lookup dying when GitHub raw is down (#270); both warn loudly if they
stop applying. Key facts:
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
- **Host hygiene matters (small boxes, ~8GB):** reap orphaned `webpack --watch` node procs, ExTester
  VS Code processes (under `$TMPDIR/test-resources`, `%TEMP%\test-resources` on Windows), and the
  browser between runs — they accumulate and
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

## Test Explorer (native Testing API, #84)

Plugin (.NET) and web-resource (Jest) tests surface in VS Code's Testing side bar via a
`TestController` created per COMPONENT in the feature `initialise*`
([src/plugins/pluginTestController.ts](../src/plugins/pluginTestController.ts),
[src/webresources/webresourceTestController.ts](../src/webresources/webresourceTestController.ts)),
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
in [continuousRun.ts](../src/webresources/continuousRun.ts) — a test file runs itself, a source file
runs them all (we don't have Jest's dependency graph, and guessing would skip the tests that matter).
