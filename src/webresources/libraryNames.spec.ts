import { describe, expect, it } from "vitest";
import { webresourceLibraryName, candidateLibraryNames } from "./libraryNames";

describe("webresourceLibraryName", () => {
  it("bundle mode maps every source file to the bundled library", () => {
    expect(webresourceLibraryName("dvpt", "bundle", "C:\\proj\\webresources_src\\Account.ts")).toBe("dvpt_library.js");
    expect(webresourceLibraryName("dvpt", undefined, "/proj/webresources_src/Contact.ts")).toBe("dvpt_library.js");
  });

  it("perFile mode maps a source file to its own web resource", () => {
    expect(webresourceLibraryName("dvpt", "perFile", "C:\\proj\\webresources_src\\Account.ts")).toBe("dvpt_Account.js");
    expect(webresourceLibraryName("dvpt", "perFile", "/proj/webresources_src/Contact.ts")).toBe("dvpt_Contact.js");
  });

  it("perFile mode still maps library.ts to the bundled name (it is not an entry)", () => {
    expect(webresourceLibraryName("dvpt", "perFile", "/proj/webresources_src/library.ts")).toBe("dvpt_library.js");
  });
});

describe("candidateLibraryNames", () => {
  it("covers both modes so a mode switch's leftovers are cleanable", () => {
    const names = candidateLibraryNames("dvpt", ["/p/webresources_src/Account.ts", "/p/webresources_src/Contact.ts"]);
    expect(names).toEqual(new Set(["dvpt_library.js", "dvpt_Account.js", "dvpt_Contact.js"]));
  });
});
