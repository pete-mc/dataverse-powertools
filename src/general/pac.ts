// One place that decides how to spawn the `pac` (Power Platform CLI) executable.
//
// On Windows pac installs as a `.cmd` shim. Since Node 18.20/20.12 (the
// CVE-2024-27980 hardening) `child_process.execFile`/`spawn` throws `spawn EINVAL`
// when handed a `.cmd`/`.bat` directly, which is exactly what happened when the
// modelbuilder resolved the full `pac.cmd` path and ran it. Route pac through
// `cmd.exe /c pac …` with an ARGS ARRAY instead: no shell string is built (so there
// is no command-injection surface), cmd resolves `pac` via PATHEXT (so a spaced
// install path is a non-issue), and we never spawn the `.cmd` directly.

/** The child_process command + args to run `pac` with the given pac arguments. */
export function pacInvocation(args: string[]): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return { command: process.env.ComSpec || "cmd.exe", args: ["/c", "pac", ...args] };
  }
  return { command: "pac", args };
}
