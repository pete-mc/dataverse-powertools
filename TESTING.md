# Testing

Test layers, from cheapest to most expensive. See [CLAUDE.md](CLAUDE.md) for how
they fit into the verify loop.

| Layer | Command | Needs |
| --- | --- | --- |
| Unit (Vitest) | `npm run test:unit` | nothing |
| Integration (extension host) | `npm run test:integration` | downloads VS Code once |
| UI (ExTester) | `npm run test:ui` | downloads VS Code + chromedriver |
| **Live (real Dataverse)** | `npm run test:live` | a `.env` with test-env credentials |

## Live tests against a real Dataverse environment

Live tests exercise the extension's real behaviour (auth, WhoAmI, and — as we add
them — webresource deploy, solution pack/import, etc.) against a **dedicated test
environment**. They self-skip when no credentials are present, so they never break
`npm run test:unit` or CI.

### One-time setup

1. Copy the example env file and fill it in:
   ```
   cp .env.example .env
   ```
   `.env` is gitignored — **never commit it, and never paste credentials into chat
   or a PR.** Use a service principal on a disposable test environment with the
   least privilege needed.

2. Run the live smoke test to confirm connectivity:
   ```
   npm run test:live
   ```
   With no `.env`, it prints "live env NOT configured — skipping" and passes.
   With a valid `.env`, it acquires a token and calls `WhoAmI`.

### The dedicated test solution

Live tests create/reuse a dedicated **`dvpttests`** solution (publisher prefix `dvpt`,
via `ensureTestSolution` in [test/live/dataverseClient.ts](test/live/dataverseClient.ts))
and add everything they create to it — so test artifacts are easy to find in the maker
portal and easy to remove wholesale, instead of scattered in the Default unmanaged layer.
Configure the names with `DVPT_TEST_SOLUTION_NAME` / `DVPT_TEST_PUBLISHER_PREFIX` (defaults
`dvpttests` / `dvpt`). When testing interactively from a sandbox project, point the
extension's solution setting at `dvpttests` too.

### The sandbox folder

`sandbox/` (gitignored) is for throwaway test projects — a webresource project, a
plugin project, a solution project — used to drive the extension against the test
environment during development. Nothing in `sandbox/` is committed. Create projects
there, point them at the test env, and open them as the workspace when launching the
extension host (F5 / `Run Extension`).

### Safety notes

- Only run live tests against the dedicated test environment, never production.
- Scope anything that writes to a known test solution / publisher prefix
  (`DVPT_TEST_SOLUTION_NAME`, `DVPT_TEST_PUBLISHER_PREFIX`) so tests stay contained.
- Credentials are read only from the environment; test output redacts secrets.

### Running live tests in CI (optional, later)

To run live tests in GitHub Actions, add the same values as repository secrets and
export them as `DVPT_TEST_*` env vars in a dedicated, opt-in job. Keep them out of
the default PR job so forks and secret-less runs still pass.

## End-to-end lifecycle suites

Two levels of end-to-end, both against the live test env:

### Command-level (headless, no editor) — `npm run test:live`

`test/live/webresourceScaffoldLifecycle.spec.ts` and `test/live/pluginLifecycle.spec.ts`
drive the whole product lifecycle **without any UI**, so they are reliable and never
fight the desktop for focus:

- **Web resources:** scaffold from the real template → `npm install` restore → generate
  typings with the bundled **net8** XrmDefinitelyTyped tool (token-auth via `DVPT_TOKEN`, no
  paket / no `.exe`) → webpack build (local webpack via `npx`, against `tsconfig.build.json`) →
  deploy through the extension's own code → verify + clean up.
- **Plugins:** `pac plugin init` → early-bound via `pac modelbuilder` (through the
  extension's `pacInvocation` helper) → `dotnet build` (net462) → package push → verify.

They self-skip without creds + `npm`/`dotnet`/`webpack`/`pac`. This is the fastest way
to confirm the two flows actually work; run before every release.

### Literal-UI (ExTester) — `npm run test:e2e`

`src/ui-test/e2e/*.e2e.ts` drives the **real VS Code window** (wizard clicks, quick
picks, commands) via Selenium. Because Selenium types into whatever window has focus,
this must run on a desktop nothing else is using — otherwise stray keystrokes corrupt
the run (a client id lands in the URL field, etc.). **Run it in an isolated Windows VM**,
never on your working desktop:

1. Fresh Windows VM (VMware/Hyper-V). Install the toolchain once:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\setup-vm-e2e.ps1
   ```
   (Node, .NET SDK, .NET Framework 4.x dev pack, Git, pac.) webpack/jest/typescript are
   **not** needed globally — every project installs them locally and the extension runs
   them via `npx`.
2. Clone this repo in the VM and copy your gitignored `sandbox/.env` into it (never
   commit it). For the interactive suites, also set `DVPT_TEST_USERNAME` /
   `DVPT_TEST_PASSWORD` to an **MFA-exempt** test user in `sandbox/.env`.
3. `npm install`, then `npm run test:e2e`. Keep the VM logged in and the console visible
   — Selenium needs an interactive desktop. Self-skips without `sandbox/.env`.

The suite is `*.e2e.ts` (not the CI `*.test.js` glob), so it stays out of CI.

**How `test:e2e` is wired.** The script runs **`scripts/runE2E.mjs`**, which:
1. **Seeds an MSAL token cache** (`scripts/preAcquireInteractiveCache.mjs`) headlessly via the
   ROPC flow (`acquireTokenByUsernamePassword`) with the MFA-exempt user, matching the
   extension's public client + `organizations` authority, and sets `DVPT_TEST_MSAL_CACHE_FILE`
   for the ExTester process. The extension has a test-only cache seam
   ([tokenAcquisition.ts](src/general/dataverse/tokenAcquisition.ts)) that reads/writes that
   file instead of secret storage, so the **interactive (OAuth) sign-in is silent** inside
   ExTester (there is no browser to drive). Seeding is best-effort — no creds → the interactive
   suites `this.skip()` and the service-principal suites still run.
2. Runs ExTester over the suites. To validate a single file:
   `node scripts/runE2E.mjs "out/ui-test/e2e/<name>.e2e.js"` (needs `npm run compile-tests`
   first for `out/`).

**Suites** (`src/ui-test/e2e/`):
- `pluginLifecycle` / `pluginInteractiveLifecycle` — scaffold + build + deploy a plugin under
  service-principal / interactive auth.
- `webresourceLifecycle` / `webresourceInteractiveLifecycle` — init → typings → class+test →
  build → deploy (+ Register Form Events on the interactive one).
- `webresourceComprehensive` — the full 8-step journey, each step **gated on the extension's own
  log line** via `expectOutput()` (a wrong/missing/failed line stops the run): init → net8
  typings → class+test with a form registration → build → build & deploy → register form events
  → open the live app in a browser and confirm the DEPLOYED code runs → **Debug Web Resources**
  locally + edit source and confirm hot reload. Steps 7–8 drive a real browser (CDP) and need
  the interactive user; they self-skip without it.
- `pluginProfilerReplay` (Windows-only) — the plug-in **Debugging** loop: scaffold a Plugins
  project + xUnit test project, write a plug-in registered on **Create of territory**, Build &
  deploy it, and assert the step is discoverable as **profilable** live (guards the
  `getProfilableSteps` server-side assembly filter — a busy org has 200+ system steps). The
  modal-driven tail (Profile next run → live Web-API trigger → **Continue** → download →
  **Replay & debug** → `dotnet test` the generated replay to green) is gated behind
  **`DVPT_E2E_PROFILER_CAPTURE=1`**: it drives a VS Code modal dialog that the shared 8GB VM can't
  hold a Selenium session through, so the reliable portion runs by default and the tail is opt-in
  (run it on a roomier box).

**VM hygiene (the box is ~8GB).** ExTester + the net8 typings fetch + webpack + a browser is
near the memory ceiling, and orphans accumulate across runs. If a run starts cascading
(`ECONNREFUSED` to the webdriver, a blank Debug step, or a typings/build timeout that normally
passes), suspect memory — **reap orphaned processes and re-run**:
```powershell
# orphaned webpack --watch, ExTester VS Code, and debug/verify browsers — NOT the user's own VS Code
Get-CimInstance Win32_Process -Filter "Name='node.exe'"  | ? { $_.CommandLine -match 'webpack' }        | % { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name='Code.exe'"  | ? { $_.CommandLine -match 'test-resources' }  | % { Stop-Process -Id $_.ProcessId -Force }
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force
```
The Debug Web Resources feature tree-kills its `webpack --watch` on stop, and the comprehensive
suite reaps stragglers in `before`, but a killed run still leaves orphans. Typings normally
completes in ~35s; a multi-minute timeout means starvation, not a slow tool. In a *very long*
working session the full ~17-min run may get killed partway — validate in shorter slices
(e.g. one suite at a time) or start a fresh session. Never kill the user's own VS Code
(`AppData\Local\Programs\Microsoft VS Code`).
