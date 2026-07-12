import * as path from "path";

// Why relative paths: VS Code URIs carry a lower-cased drive letter ("c:\…") while jest
// resolves its rootDir from the spawn cwd with whatever casing that has, and
// --runTestsByPath compares the two as case-sensitive strings — the mismatch makes jest
// report "No tests found … Files: c:\…" for files that plainly exist (the Test Explorer
// bug). Relative forward-slash paths never mention the drive, sidestepping the whole
// class. pathImpl is injected so both platforms' behaviour is unit-testable anywhere.
export function jestPathArgs(cwd: string, files: Iterable<string>, pathImpl: Pick<typeof path.win32, "relative" | "isAbsolute" | "sep"> = path): string[] {
  const testPaths = [...files].map((file) => {
    const relative = pathImpl.relative(cwd, file);
    const usable = relative && !relative.startsWith("..") && !pathImpl.isAbsolute(relative) ? relative : file;
    return usable.split(pathImpl.sep).join("/");
  });
  return ["--runTestsByPath", ...testPaths];
}
