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

- **Web resources:** scaffold from the real template → run the restore commands (npm +
  paket) → run XrmDefinitelyTyped for typings → webpack build → deploy through the
  extension's own code → verify + clean up.
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
   (Node, .NET SDK, .NET Framework 4.x dev pack, Git, pac, global webpack/typescript.)
2. Clone this repo in the VM and copy your gitignored `sandbox/.env` into it (never
   commit it).
3. `npm install`, then `npm run test:e2e`. Keep the VM logged in and the console visible
   — Selenium needs an interactive desktop. Self-skips without `sandbox/.env`.

The suite is `*.e2e.ts` (not the CI `*.test.js` glob), so it stays out of CI.
