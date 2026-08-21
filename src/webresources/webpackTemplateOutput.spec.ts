// @vitest-environment node
//
// The SHIPPING webpack.common.js template decides the deployed bundle's filename; libraryNames.ts
// decides what form registrations point AT. They have to agree, and nothing but this test checks
// that they do — which is the exact failure the module header of libraryNames.ts records: the old
// regex scrape of this template silently drifted and produced a <Library> with no name attribute,
// so Dataverse rejected whole forms with 0x80048425.
//
// So this loads the real template, with a real settings file, and asserts the filename it computes
// is character-for-character what webresourceLibraryName predicts.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
import { webresourceLibraryName } from "./libraryNames";
import { applyProjectPlaceholders } from "../general/templateSubstitution";

const TEMPLATE = path.resolve(__dirname, "../../templates/webresources/webpack.common.js/1.js");
const PREFIX = "dvpt";

let root: string;

/** Materialise a project the template can load: its settings file, and the one module it
 * require.resolve()s at load time. */
function project(settings: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(root, "proj-"));
  fs.mkdirSync(path.join(dir, "webresources_src", "lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "webresources_src", "lib", "dg.xrmquery.web.min.js"), "module.exports = {};", "utf8");
  fs.writeFileSync(path.join(dir, "webresources_src", "library.ts"), "export {};", "utf8");
  fs.writeFileSync(path.join(dir, "dataverse-powertools.json"), JSON.stringify({ prefix: PREFIX, ...settings }), "utf8");
  fs.writeFileSync(path.join(dir, "webpack.common.js"), applyProjectPlaceholders(fs.readFileSync(TEMPLATE, "utf8"), { prefix: PREFIX }), "utf8");
  return dir;
}

/** The output filename the project's own webpack config would use. */
function outputFilename(settings: Record<string, unknown>): string {
  const dir = project(settings);
  const config = createRequire(path.join(dir, "webpack.common.js"))(path.join(dir, "webpack.common.js"));
  return config.output.filename;
}

describe("webpack.common.js template vs libraryNames (#258)", () => {
  beforeAll(() => {
    // Inside the repo, not the system temp dir: the template `require("webpack")`, and node only
    // finds it by walking up to this repo's node_modules — exactly as it does in a real project
    // that has webpack as a local devDependency.
    root = fs.mkdtempSync(path.resolve(__dirname, "../../.tmp-webpack-spec-"));
  });
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("emits the historical name when the project configures nothing", () => {
    expect(outputFilename({})).toBe("dvpt_library.js");
    expect(outputFilename({})).toBe(webresourceLibraryName(PREFIX, "bundle", "library.ts"));
  });

  it("emits the configured bundle name, matching what registrations will point at", () => {
    expect(outputFilename({ webresourceLibraryName: "grid" })).toBe("dvpt_grid.js");
    expect(outputFilename({ webresourceLibraryName: "grid" })).toBe(webresourceLibraryName(PREFIX, "bundle", "library.ts", "grid"));
  });

  it("agrees with libraryNames on junk input rather than emitting a nameless resource", () => {
    for (const configured of ["", "!!!", "my grid!"]) {
      expect(outputFilename({ webresourceLibraryName: configured }), configured).toBe(webresourceLibraryName(PREFIX, "bundle", "library.ts", configured));
    }
  });

  it("leaves per-file mode on webpack's own [name] token", () => {
    // Per-file names come from the source filenames, so the bundle setting must not touch them.
    expect(outputFilename({ webresourceOutput: "perFile", webresourceLibraryName: "grid" })).toBe("dvpt_[name].js");
  });
});
