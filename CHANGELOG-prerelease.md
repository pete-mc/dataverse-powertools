# Change Log — pre-release channel

Per-version notes for the **pre-release** builds published between full releases. They are
kept out of [CHANGELOG.md](CHANGELOG.md) so the Marketplace changelog stays readable: at each
full release these entries are rolled up into a single stable section over there and this file
is cleared to start accumulating the next cycle (`node scripts/rollupChangelog.mjs <version>`).

Everything below has shipped to the pre-release channel and is not yet in a full release.

## 1.0.7 (pre-release)

**Name your PCF control when you scaffold it**

Creating a PCF control now asks for its name and namespace, suggesting a name based on the
component's folder. Before this it never asked, so *every* control this extension scaffolded was
called `SampleNamespace.SampleControl` — which meant two PCF components in one workspace pushed to
the same control in Dataverse and the second quietly replaced the first. Existing controls are
untouched; this only affects newly scaffolded ones.

**Two Web Resources components no longer deploy over each other**

In bundled output mode the built library deploys as `<prefix>_library.js`. That name was fixed, so
two Web Resources components in one workspace both produced it and whichever deployed second won.

The bundle name is now a project setting, `webresourceLibraryName`. A component added in a
subfolder is given its folder name automatically, so the collision doesn't arise; the root
component keeps `library`, which means **no existing project's deployed web resource changes name**
— nothing gets orphaned and no form registration breaks. Form registrations still recognise the
old name too, so if you do rename a bundle, handlers pointing at the previous one are cleaned up
rather than stranded. Existing projects pick this up through *Refresh Project Config Files*.

**Replaying a plug-in profile now works on macOS and Linux too**

Capturing stopped being Windows-only earlier in this cycle; *replaying* the captured run — and so
**Replay & debug**, with breakpoints inside your plug-in — was still stuck there, because the
scaffolded test project targeted .NET Framework and `dotnet test` needs a .NET Framework test host
to run one.

New plug-in projects now target **`net462;net8.0`**: `net462` is still exactly what gets deployed to
Dataverse — the package we build and push is unchanged, down to its dependency list — while the
extra target is what your **tests** build and run against. That's all it took; the replay harness
itself never needed .NET Framework. Setting up unit testing or generating a replay test on an
existing project offers the same upgrade. A test project pinned to .NET Framework by its own
packages (the old FakeXrmEasy scaffold, say) is left exactly as it is.

**Capturing a plug-in profile now works on macOS and Linux**

*Profile next run* — and the per-step **Profile** CodeLens — were Windows-only. Everyone else had
to capture in the Plug-in Registration Tool and come back to *Download a run*.

They aren't Windows-only any more. Starting and stopping profiling are now ordinary Dataverse Web
API calls made by the extension itself, so the whole capture → download → **Generate Replay Test**
journey runs wherever VS Code does, under both service-principal and interactive sign-in. The
bundled .NET Framework helper that used to do this is gone, along with the ~12MB of Plug-in
Registration Tool assemblies it downloaded onto your machine the first time you profiled anything.

(*Replaying* a captured run needed .NET Framework when this shipped; it doesn't any more — see the
entry above.)

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

