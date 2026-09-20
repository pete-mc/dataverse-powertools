# Cross-platform status

Reference moved out of AGENTS.md; the short rules (never hand-concatenate paths, `DvptDeployBuild=true` on both build and pack, etc.) are repeated there. Links are relative to this folder.

The extension is being made OS-agnostic. Dataverse plugins *target* .NET Framework
4.6.2 (a sandbox-runtime constraint, moving to net48 ~Q4 2026), but that does **not**
require building on Windows — `dotnet build` compiles net462 on any OS, and the
modern plugin flow already shells out to `dotnet`/`pac`.

- **Never hand-concatenate paths.** Use `path.join` (or the helpers in
  [src/general/paths.ts](../src/general/paths.ts)). The old `fsPath + "\\" + name` broke
  the whole extension off-Windows.
- **Solutions are cross-platform.** [src/solution](../src/solution) now uses `pac`
  (`pac auth create` + `pac solution pack/unpack/export/import`) instead of `spkl.exe`.
  Config still comes from `spkl.json` (just a config file now — no spkl tool). Auth
  uses a single named pac profile, `dataverse-powertools`, recreated per run from the
  connection string's service principal. Pure arg builders live in
  [src/solution/pacArgs.ts](../src/solution/pacArgs.ts) (unit-tested) — add/verify flags
  there against the pac reference.
- **Webresource typings are cross-platform now** (#78/#91): a bundled **net8** build of
  XrmDefinitelyTyped run via `dotnet`, in `tools/xrmdefinitelytyped/`, authenticated with the
  extension's own access token via the `DVPT_TOKEN` env var — so it works on any OS and under
  both service-principal and interactive auth (no client secret, no Windows-only `.exe`). The
  tool isn't committed; `scripts/fetchTypingsTool.mjs` fetches it into `tools/` on install /
  prepublish. Pure arg builders live in
  [generateTypings.ts](../src/webresources/generateTypings.ts) (`buildTypingsArgs`, unit-tested).
- **Profiler capture is cross-platform now** (#264): `Profile next run` / the per-step Profile
  CodeLens used to shell out to a bundled **net48** tool (`profiler-tool/`) because PRT's
  `ProfilerManagementUtility.EnablePlugin` takes a .NET-Framework `CrmServiceClient`. Decompiling
  that method showed it is only ordinary SDK requests, so it now lives in
  [profilerSteps.ts](../src/general/dataverse/profilerSteps.ts) as Web API calls — the tool, its build
  script and the `windows-latest` pin on the publish job are all gone. **The `configuration` blob is
  a contract with the profiler's own server-side plug-in** (a `DataContractSerializer` over
  `[DataContract(Name = "Configuration", Namespace = "")]`): members are ALPHABETICAL and unset ones
  are `i:nil`, and `profilerSteps.spec.ts` pins the exact bytes against a real serializer's output.
  Don't "tidy" that emitter. Enable also MOVES the step's images to the clone and DISABLES the
  original — miss either and the profiler silently never fires.
- **Replay is cross-platform now (#269).** The plug-in project **multi-targets `net462;net8.0`**
  ([multiTarget.ts](../src/plugins/multiTarget.ts)) so the test project can be net8.0 — which is the
  only way `dotnet test` runs without a .NET Framework test host (on Ubuntu net4x builds fine, then
  aborts with "Could not find 'mono' host"). `debugTypeForFramework` therefore resolves to
  `coreclr`, so `Replay & debug` works off Windows too. **Only the DEPLOYED assembly is net462.**
  Three things must stay true, and each has a test:
  - **`DvptDeployBuild=true` goes on BOTH the `dotnet build` and the `dotnet pack`** in
    [buildAndDeploy.ts](../src/plugins/buildAndDeploy.ts). It collapses the project back to net462, and
    pack derives the nuspec's dependency groups from the RESTORE graph — so packing a project
    restored for both frameworks emits a stray `<group targetFramework="net8.0" />` and warns
    NU5128, even though only `lib/net462` is packed. Pack reuses the build via `--no-build`, so a
    property on only one of them is a different graph than the one being packed.
  - **`ensureReplayCsproj` is TFM-aware**: on a modern test project it must supply Microsoft.Xrm.Sdk
    from the netstandard `Microsoft.PowerPlatform.Dataverse.Client`, NOT the Framework-only
    `Microsoft.CrmSdk.CoreAssemblies` (which fails restore) — that injection was the original pin.
  - **A test project pinned to Framework by its OWN references is left alone** (`FakeXrmEasy.9` in
    the legacy template-v2 scaffold, `Microsoft.CrmSdk.*`). Modernising it would trade a working
    Windows test run for a broken one everywhere.
  The guard is [test/live/replayHarnessNet8.spec.ts](../test/live/replayHarnessNet8.spec.ts) — it drives
  the SHIPPING generators through a real `dotnet build`/`pack`/`test`, needs **no org and no
  credentials**, and runs anywhere `dotnet` does (~27s under `npm run test:live`).
- **Still Windows-only:** just ONE thing, and it is a cross-check rather than a product path — the
  replay step in `test/live/pluginProfilerCaptureLifecycle.spec.ts`, which executes *Microsoft's*
  net462 profiler engine (`PluginProfiler.Library`) to confirm a profile we captured is one the
  shipping PRT also accepts. The e2e browser automation is NOT Windows-only: `browserResolver.ts`
  resolves Edge/Chrome on Linux and `scripts/setup-linux-e2e.sh` installs Edge. With `plugins_old/`
  gone (#228) nothing else pins `spkl.exe`/`sn.exe`.
