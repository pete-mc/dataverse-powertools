import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// #95's acceptance criterion, finally met: the sibling spec pins the SHAPE of the build config
// (types: [], tests excluded); this one proves the shape does the job, by actually running tsc
// against the shipped templates in a project where @types/jest is NOT installed.
//
// That layout — @types/jest hoisted to a parent node_modules, or absent because the project was
// restored with `--production`, or pnpm's non-flat store — is exactly what broke Build before #95,
// and it is untestable on the e2e VM because that VM has @types/jest installed.
//
// The project MUST live outside this repo: node's resolution walks parent directories, so a temp
// dir under the repo would find the repo's OWN @types/jest and the test would pass vacuously.
const templateDir = path.resolve(__dirname, "..", "..", "templates", "webresources");
const tsc = path.resolve(__dirname, "..", "..", "node_modules", "typescript", "bin", "tsc");

function readTemplate(name: string, file: string): string {
  return fs.readFileSync(path.join(templateDir, name, file), "utf8");
}

/** tsc against `project`, from the project dir, with the repo's own compiler. Returns combined output. */
function typeCheck(projectDir: string, project: string): { ok: boolean; output: string } {
  const run = spawnSync(process.execPath, [tsc, "--project", project, "--noEmit"], { cwd: projectDir, encoding: "utf8" });
  return { ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

describe("webresource production build without a local @types/jest (#95)", () => {
  let projectDir: string;

  beforeAll(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-jesttypes-"));
    fs.writeFileSync(path.join(projectDir, "tsconfig.json"), readTemplate("tsconfig.json", "1.json"), "utf8");
    fs.writeFileSync(path.join(projectDir, "tsconfig.build.json"), readTemplate("tsconfig.build.json", "1.json"), "utf8");

    // A source file and a Jest test beside it, in the layout the scaffold produces. The test uses
    // bare `describe`/`expect`, so it only compiles when the Jest globals are in the program — which
    // is the point: the production build must not have it in the program at all.
    const src = path.join(projectDir, "webresources_src");
    fs.mkdirSync(path.join(src, "__tests__"), { recursive: true });
    fs.writeFileSync(path.join(src, "sample.ts"), "export class Sample {\n  static greet(name: string): string {\n    return `hello ${name}`;\n  }\n}\n", "utf8");
    fs.writeFileSync(
      path.join(src, "__tests__", "sample.test.ts"),
      'import { Sample } from "../sample";\n\ndescribe("Sample", () => {\n  it("greets", () => {\n    expect(Sample.greet("x")).toBe("hello x");\n  });\n});\n',
      "utf8",
    );
    // No node_modules at all — the strongest form of "@types/jest isn't local".
  });

  afterAll(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("compiles with tsconfig.build.json when @types/jest is not installed", () => {
    const { ok, output } = typeCheck(projectDir, "tsconfig.build.json");
    expect(output, "tsc output").not.toContain("@types/jest");
    expect(ok, `production build should type-check without @types/jest:\n${output}`).toBe(true);
  }, 60000);

  // Anti-vacuous control. Without it, the test above would still pass if tsc had quietly stopped
  // caring about `types` — and #95 would be "covered" by a test that cannot fail.
  it("would fail without the types:[] override — proving that override is what saves it", () => {
    const inherited = path.join(projectDir, "tsconfig.regressed.json");
    const cfg = JSON.parse(readTemplate("tsconfig.build.json", "1.json"));
    delete cfg.compilerOptions.types; // regress to inheriting tsconfig.json's types: ["@types/jest"]
    fs.writeFileSync(inherited, JSON.stringify(cfg, null, 2), "utf8");

    const { ok, output } = typeCheck(projectDir, "tsconfig.regressed.json");
    expect(ok, "inheriting types:['@types/jest'] should NOT type-check here").toBe(false);
    expect(output).toContain("@types/jest");
  }, 60000);

  it("keeps Jest tests out of the production program entirely", () => {
    // `exclude` is the other half: even with the Jest globals unavailable, a test file left in the
    // program would fail on `describe`. Compile the DEV config (which does load @types/jest… except
    // it isn't installed) to show the test file is the only thing that would break, then confirm the
    // build config never sees it.
    const listed = spawnSync(process.execPath, [tsc, "--project", "tsconfig.build.json", "--listFiles", "--noEmit"], { cwd: projectDir, encoding: "utf8" });
    const files = `${listed.stdout ?? ""}`;
    expect(files).toContain(`sample.ts`);
    expect(files).not.toContain("sample.test.ts");
  }, 60000);
});
