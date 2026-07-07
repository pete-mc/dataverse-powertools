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
