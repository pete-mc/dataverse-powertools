import { describe, expect, it } from "vitest";
import {
  webresourceLibraryName,
  candidateLibraryNames,
  defaultLibraryBaseName,
  libraryBaseFor,
  isValidLibraryBase,
  isPerFileEntry,
  pathBelowSourceRoot,
  deployedWebresourceNames,
  findWebresourceNameCollisions,
  freeLibraryBase,
  DEFAULT_LIBRARY_BASE,
} from "./libraryNames";

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

  // Backs the scaffold prompt's validateInput: reject as the user types rather than silently
  // sanitising into a name they didn't choose and won't recognise in the maker portal.
  describe("isValidLibraryBase", () => {
    it("accepts what survives sanitising unchanged", () => {
      expect(isValidLibraryBase("library")).toBe(true);
      expect(isValidLibraryBase("account_forms")).toBe(true);
      expect(isValidLibraryBase("Grid2")).toBe(true);
    });

    it("rejects anything that would be silently rewritten", () => {
      expect(isValidLibraryBase("")).toBe(false);
      expect(isValidLibraryBase("my grid")).toBe(false);
      expect(isValidLibraryBase("my-grid")).toBe(false);
      expect(isValidLibraryBase("grid.js")).toBe(false);
    });

    it("accepts every name the scaffold would suggest", () => {
      // The prompt is prefilled with the suggestion, so a suggestion its own validator rejects
      // would present as an error box the user has to fix before they can continue.
      for (const folder of ["", "controls", "account-forms", "2fast", "---", "src/deep/nested"]) {
        expect(isValidLibraryBase(defaultLibraryBaseName(folder)), folder).toBe(true);
      }
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

// Per-file mode builds only the TOP-LEVEL webresources_src/*.ts (not library.ts) — but the form
// registration scan is recursive and includes the barrel, so a registration in a file that mode
// never builds used to bind a handler to a web resource that doesn't exist.
describe("isPerFileEntry — what per-file mode actually builds", () => {
  it("matches the webpack template's filter for top-level sources", () => {
    expect(isPerFileEntry("Account.ts")).toBe(true);
    expect(isPerFileEntry("Contact.ts")).toBe(true);
  });

  it("excludes the barrel, type declarations and nested files", () => {
    expect(isPerFileEntry("library.ts")).toBe(false);
    expect(isPerFileEntry("PowerTools.d.ts")).toBe(false);
    expect(isPerFileEntry("sub/Thing.ts")).toBe(false);
    expect(isPerFileEntry("lib/dg.xrmquery.web.min.ts")).toBe(false);
  });

  it("excludes non-TypeScript files", () => {
    expect(isPerFileEntry("Account.js")).toBe(false);
    expect(isPerFileEntry("")).toBe(false);
  });
});

describe("pathBelowSourceRoot", () => {
  it("returns the path below webresources_src, on either separator", () => {
    expect(pathBelowSourceRoot("/p/webresources_src/Account.ts")).toBe("Account.ts");
    expect(pathBelowSourceRoot("C:\\p\\webresources_src\\sub\\Thing.ts")).toBe("sub/Thing.ts");
  });

  it("falls back to the filename when it can't place the path", () => {
    // Treated as top-level, i.e. buildable — skipping a registration we merely failed to classify
    // would be worse than processing it.
    expect(pathBelowSourceRoot("/somewhere/else/Account.ts")).toBe("Account.ts");
    expect(isPerFileEntry(pathBelowSourceRoot("/somewhere/else/Account.ts"))).toBe(true);
  });
});

describe("deployedWebresourceNames — a component's claim on the shared namespace", () => {
  it("bundle mode claims exactly one name", () => {
    expect(deployedWebresourceNames("dvpt", undefined, ["Account.ts", "Contact.ts"])).toEqual(["dvpt_library.js"]);
    expect(deployedWebresourceNames("dvpt", { webresourceLibraryName: "grid" }, ["Account.ts"])).toEqual(["dvpt_grid.js"]);
  });

  it("per-file mode claims one name per BUILDABLE source file", () => {
    const names = deployedWebresourceNames("dvpt", { webresourceOutput: "perFile" }, ["Account.ts", "Contact.ts", "library.ts", "sub/Thing.ts", "PowerTools.d.ts"]);
    expect(names.sort()).toEqual(["dvpt_Account.js", "dvpt_Contact.js"]);
  });

  it("per-file mode ignores the configured bundle name — it deploys no bundle", () => {
    expect(deployedWebresourceNames("dvpt", { webresourceOutput: "perFile", webresourceLibraryName: "grid" }, ["Account.ts"])).toEqual(["dvpt_Account.js"]);
  });
});

describe("findWebresourceNameCollisions", () => {
  it("finds two bundle components claiming the same name", () => {
    const collisions = findWebresourceNameCollisions([
      { relativeRoot: "", names: ["dvpt_library.js"] },
      { relativeRoot: "controls", names: ["dvpt_library.js"] },
    ]);
    expect(collisions).toEqual([{ name: "dvpt_library.js", components: ["", "controls"] }]);
  });

  it("finds two PER-FILE components sharing a source filename", () => {
    // The case a bundle-only detector would miss: both components have an Account.ts, so both
    // deploy dvpt_Account.js and the second silently replaces the first.
    const collisions = findWebresourceNameCollisions([
      { relativeRoot: "a", names: ["dvpt_Account.js", "dvpt_Lead.js"] },
      { relativeRoot: "b", names: ["dvpt_Account.js", "dvpt_Case.js"] },
    ]);
    expect(collisions).toEqual([{ name: "dvpt_Account.js", components: ["a", "b"] }]);
  });

  it("finds a bundle name colliding with a per-file name", () => {
    // A per-file component with library.ts renamed, or a bundle named after a class — same clash.
    const collisions = findWebresourceNameCollisions([
      { relativeRoot: "a", names: ["dvpt_Account.js"] },
      { relativeRoot: "b", names: ["dvpt_Account.js"] },
    ]);
    expect(collisions.map((c) => c.name)).toEqual(["dvpt_Account.js"]);
  });

  it("is quiet when every component claims distinct names", () => {
    expect(
      findWebresourceNameCollisions([
        { relativeRoot: "", names: ["dvpt_library.js"] },
        { relativeRoot: "controls", names: ["dvpt_controls.js"] },
      ]),
    ).toEqual([]);
  });

  it("does not report a component colliding with itself", () => {
    expect(findWebresourceNameCollisions([{ relativeRoot: "a", names: ["dvpt_Account.js", "dvpt_Account.js"] }])).toEqual([]);
  });

  it("reports every contested name, not just the first", () => {
    const collisions = findWebresourceNameCollisions([
      { relativeRoot: "a", names: ["dvpt_Account.js", "dvpt_Lead.js"] },
      { relativeRoot: "b", names: ["dvpt_Account.js", "dvpt_Lead.js"] },
    ]);
    expect(collisions.map((c) => c.name)).toEqual(["dvpt_Account.js", "dvpt_Lead.js"]);
  });
});

describe("freeLibraryBase", () => {
  it("keeps the preferred name when it is free", () => {
    expect(freeLibraryBase("controls", ["library"])).toBe("controls");
  });

  it("suffixes until it finds a free one", () => {
    expect(freeLibraryBase("library", ["library"])).toBe("library2");
    expect(freeLibraryBase("library", ["library", "library2"])).toBe("library3");
  });

  it("compares case-insensitively, since Dataverse names are", () => {
    expect(freeLibraryBase("Library", ["library"])).toBe("Library2");
  });

  it("always returns something the naming rules accept", () => {
    expect(freeLibraryBase("", [])).toBe("library");
    expect(freeLibraryBase("!!!", ["library"])).toBe("library2");
  });
});

// Renaming a bundle leaves handlers on forms bound to the OLD name. Those are ours; if they drop
// out of the owned set they can never be cleaned up and stay pointed at a resource nobody deploys.
describe("candidateLibraryNames keeps previous names owned after a rename (#258)", () => {
  it("owns the current name, the historical library, and every previous name", () => {
    const names = candidateLibraryNames("dvpt", ["/p/webresources_src/Account.ts"], "grid3", ["grid", "grid2"]);
    expect([...names].sort()).toEqual(["dvpt_Account.js", "dvpt_grid.js", "dvpt_grid2.js", "dvpt_grid3.js", "dvpt_library.js"]);
  });

  it("is unchanged when a component has never been renamed", () => {
    const names = candidateLibraryNames("dvpt", ["/p/webresources_src/Account.ts"], "grid", []);
    expect([...names].sort()).toEqual(["dvpt_Account.js", "dvpt_grid.js", "dvpt_library.js"]);
  });

  it("sanitises previous names rather than emitting a nameless library", () => {
    const names = candidateLibraryNames("dvpt", [], "grid", ["!!!"]);
    expect(names.has("dvpt_library.js")).toBe(true);
    expect([...names].every((n) => n !== "dvpt_.js")).toBe(true);
  });
});
