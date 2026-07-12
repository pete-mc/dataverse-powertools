import { describe, expect, it } from "vitest";
import * as path from "path";
import { jestPathArgs } from "./jestPaths";

describe("jestPathArgs", () => {
  it("passes test files relative to the jest cwd with forward slashes", () => {
    const args = jestPathArgs("C:\\repo\\webresources", ["C:\\repo\\webresources\\webresources_src\\__tests__\\Account.test.ts"], path.win32);
    expect(args).toEqual(["--runTestsByPath", "webresources_src/__tests__/Account.test.ts"]);
  });

  it("survives VS Code's lower-cased drive letter (the Test Explorer no-tests-found bug)", () => {
    // uri.fsPath yields "c:\…" while jest's rootDir has "C:\…" — absolute paths fail
    // jest's case-sensitive comparison; the relative form must not mention the drive.
    const args = jestPathArgs("C:\\Users\\Peter\\proj", ["c:\\Users\\peter\\proj\\webresources_src\\__tests__\\Contact.test.ts"], path.win32);
    expect(args).toEqual(["--runTestsByPath", "webresources_src/__tests__/Contact.test.ts"]);
  });

  it("keeps files outside the cwd as forward-slashed absolute paths", () => {
    const args = jestPathArgs("C:\\repo\\a", ["C:\\other\\t.test.ts"], path.win32);
    expect(args).toEqual(["--runTestsByPath", "C:/other/t.test.ts"]);
  });

  it("works with posix paths", () => {
    const args = jestPathArgs("/repo/webresources", ["/repo/webresources/webresources_src/__tests__/a.test.ts"], path.posix);
    expect(args).toEqual(["--runTestsByPath", "webresources_src/__tests__/a.test.ts"]);
  });

  it("handles multiple files", () => {
    const args = jestPathArgs("C:\\p", ["C:\\p\\a.test.ts", "C:\\p\\sub\\b.test.ts"], path.win32);
    expect(args).toEqual(["--runTestsByPath", "a.test.ts", "sub/b.test.ts"]);
  });
});
