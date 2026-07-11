// One place that decides how to spawn the `pac` (Power Platform CLI) executable.
//
// On Windows pac usually installs as a `.cmd` shim. Since Node 18.20/20.12 (the
// CVE-2024-27980 hardening) `child_process.execFile`/`spawn` throws `spawn EINVAL`
// when handed a `.cmd`/`.bat` directly. Preferred route (#104): find the REAL
// `pac.exe` (dotnet-tool and MSI installs ship one) and spawn it directly — no
// shell at all. Fallback: `cmd.exe /c pac …` with an ARGS ARRAY (no shell string
// is built, cmd resolves `pac` via PATHEXT, and we never spawn the `.cmd`).
import * as fs from "fs";
import * as path from "path";

/** Locate pac.exe on a PATH-style string. Pure — exists() is injected for tests. */
export function findPacExecutable(pathValue: string | undefined, exists: (candidate: string) => boolean): string | undefined {
  for (const dir of (pathValue ?? "").split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = path.join(dir, "pac.exe");
    if (exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

// undefined = not probed yet; null = probed, no pac.exe found (use the cmd fallback).
let cachedPacExe: string | null | undefined;

/** Re-probe for pac.exe on the next invocation (tests; after installing pac). */
export function resetPacExecutableCache(): void {
  cachedPacExe = undefined;
}

/** The child_process command + args to run `pac` with the given pac arguments. */
export function pacInvocation(args: string[]): { command: string; args: string[] } {
  if (process.platform === "win32") {
    if (cachedPacExe === undefined) {
      // PATH plus the default dotnet-tools dir (covers `dotnet tool install` when
      // the shell hasn't picked up the PATH addition yet).
      const dotnetTools = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".dotnet", "tools") : undefined;
      const searchPath = [process.env.PATH, dotnetTools].filter(Boolean).join(path.delimiter);
      cachedPacExe = findPacExecutable(searchPath, fs.existsSync) ?? null;
    }
    if (cachedPacExe) {
      return { command: cachedPacExe, args };
    }
    // A constant executable name (not read from %ComSpec%) so the command being spawned can
    // never be redirected by the environment; cmd.exe is resolved from the system directory.
    return { command: "cmd.exe", args: ["/c", "pac", ...args] };
  }
  return { command: "pac", args };
}
