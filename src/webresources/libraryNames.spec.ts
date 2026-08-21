import { describe, expect, it } from "vitest";
import { webresourceLibraryName, candidateLibraryNames, defaultLibraryBaseName, libraryBaseFor, DEFAULT_LIBRARY_BASE } from "./libraryNames";

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

// #258 — deployWebresources uploads everything in bin/ BY FILENAME, so two web-resource
// components that both emit {prefix}_library.js silently deploy over each other.
describe("configurable bundle name (#258)", () => {
  it("still emits the historical name when nothing configures one", () => {
    // The whole migration story rests on this: no existing project changes.
    expect(webresourceLibraryName("dvpt", "bundle", "/p/webresources_src/Account.ts")).toBe("dvpt_library.js");
    expect(DEFAULT_LIBRARY_BASE).toBe("library");
  });

  it("uses a configured bundle base in bundle mode", () => {
    expect(webresourceLibraryName("dvpt", "bundle", "/p/webresources_src/Account.ts", "grid")).toBe("dvpt_grid.js");
    expect(webresourceLibraryName("dvpt", undefined, "/p/webresources_src/Account.ts", "grid")).toBe("dvpt_grid.js");
  });

  it("does not affect per-file names, which are already unique per source file", () => {
    expect(webresourceLibraryName("dvpt", "perFile", "/p/webresources_src/Account.ts", "grid")).toBe("dvpt_Account.js");
    // library.ts is the barrel, so it maps to the bundle name even in per-file mode.
    expect(webresourceLibraryName("dvpt", "perFile", "/p/webresources_src/library.ts", "grid")).toBe("dvpt_grid.js");
  });

  it("falls back rather than emitting a nameless resource for junk input", () => {
    // A nameless <Library> is what Dataverse rejected with 0x80048425 — never emit one.
    expect(webresourceLibraryName("dvpt", "bundle", "/p/x.ts", "")).toBe("dvpt_library.js");
    expect(webresourceLibraryName("dvpt", "bundle", "/p/x.ts", "!!!")).toBe("dvpt_library.js");
    expect(webresourceLibraryName("dvpt", "bundle", "/p/x.ts", "my grid!")).toBe("dvpt_mygrid.js");
  });

  describe("defaultLibraryBaseName", () => {
    it("keeps the root component on library, so existing projects are untouched", () => {
      expect(defaultLibraryBaseName("")).toBe("library");
    });

    it("names a sub-component after its folder, so two of them differ", () => {
      expect(defaultLibraryBaseName("controls")).toBe("controls");
      expect(defaultLibraryBaseName("src/accountForms")).toBe("accountForms");
      expect(defaultLibraryBaseName("src\\contactForms")).toBe("contactForms");
      expect(defaultLibraryBaseName("web-one")).not.toBe(defaultLibraryBaseName("web-two"));
    });

    it("strips what a web-resource name cannot carry, and falls back if nothing survives", () => {
      expect(defaultLibraryBaseName("my-forms")).toBe("myforms");
      expect(defaultLibraryBaseName("---")).toBe("library");
    });
  });

  describe("libraryBaseFor", () => {
    it("defaults when unset, empty, or all-junk", () => {
      expect(libraryBaseFor(undefined)).toBe("library");
      expect(libraryBaseFor({})).toBe("library");
      expect(libraryBaseFor({ webresourceLibraryName: "" })).toBe("library");
      expect(libraryBaseFor({ webresourceLibraryName: "!!" })).toBe("library");
    });

    it("returns the configured name", () => {
      expect(libraryBaseFor({ webresourceLibraryName: "grid" })).toBe("grid");
    });
  });

  describe("candidateLibraryNames keeps the OLD name deletable", () => {
    it("owns both the configured bundle and the historical library name", () => {
      // A project that renames its bundle still has handlers pointing at {prefix}_library.js.
      // Dropping it from the owned set would strand them on a resource nobody deploys any more.
      const names = candidateLibraryNames("dvpt", ["/p/webresources_src/Account.ts"], "grid");
      expect(names.has("dvpt_grid.js")).toBe(true);
      expect(names.has("dvpt_library.js")).toBe(true);
      expect(names.has("dvpt_Account.js")).toBe(true);
    });

    it("is unchanged for a project that configures nothing", () => {
      const names = candidateLibraryNames("dvpt", ["/p/webresources_src/Account.ts"]);
      expect([...names].sort()).toEqual(["dvpt_Account.js", "dvpt_library.js"]);
    });
  });
});
