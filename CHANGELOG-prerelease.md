# Change Log — pre-release channel

Per-version notes for the **pre-release** builds published between full releases. They are
kept out of [CHANGELOG.md](CHANGELOG.md) so the Marketplace changelog stays readable: at each
full release these entries are rolled up into a single stable section over there and this file
is cleared to start accumulating the next cycle (`node scripts/rollupChangelog.mjs <version>`).

Everything below has shipped to the pre-release channel and is not yet in a full release.

## 1.0.7 (pre-release)

**Capturing a plug-in profile now works on macOS and Linux**

*Profile next run* — and the per-step **Profile** CodeLens — were Windows-only. Everyone else had
to capture in the Plug-in Registration Tool and come back to *Download a run*.

They aren't Windows-only any more. Starting and stopping profiling are now ordinary Dataverse Web
API calls made by the extension itself, so the whole capture → download → **Generate Replay Test**
journey runs wherever VS Code does, under both service-principal and interactive sign-in. The
bundled .NET Framework helper that used to do this is gone, along with the ~12MB of Plug-in
Registration Tool assemblies it downloaded onto your machine the first time you profiled anything.

*Replaying* a captured run under the debugger still needs .NET Framework — your plug-in test
project targets it — so that step remains Windows (or macOS/Linux with mono). Capturing,
downloading, generating the replay test and reading trace logs no longer do.

**Stopping profiling now always puts your step back**

Off Windows, *Stop* used to delete the profiler's clone and leave your original step **disabled** —
which silently stopped your plug-in from running at all, and told you to go re-enable it in the
Plug-in Registration Tool. Stopping now restores the step's name, its images and its enabled state
on every platform.

**New setting: `dataverse-powertools.debugBrowserArgs`**

Extra command-line arguments to pass to the browser that *Debug Web Resources* and the PCF live-form
debugger launch — a sibling to `dataverse-powertools.debugBrowserPath`. It exists for environments
whose browser needs a flag to start at all (a container, or a Linux distribution whose sandbox
restrictions stop Chromium launching). Empty by default on every platform: nothing is passed unless
you ask for it, and in particular no sandbox-weakening flag ships as a default.

