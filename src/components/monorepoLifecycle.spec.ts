import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveComponents, resolveTargetComponent, componentsOfType, DiscoveredComponent, normalizeFsPath } from "./discovery";

// Monorepo lifecycle (#47/#119): a connection-only root with TWO components of EVERY
// type in subfolders, scaffolded from the REAL templates. Proves the two things that
// matter for a multi-component workspace, headlessly and deterministically (no VS Code,
// no network, no Selenium): (1) commands resolve to the RIGHT component, and (2) each
// component's template is set up correctly (per-type marker files present, placeholders
// substituted, connection inherited not duplicated). The plugin v3 pac-init layer and the
// full build/deploy round-trip are UI-covered by the blank-root e2e; here we exercise the
// pure copy+substitute engine (identical across versions) plus the type-agnostic resolver.

const TEMPLATES = path.resolve(__dirname, "..", "..", "templates");
const PREFIX = "mono";
const SOLUTION = "MonoSolution";
const CONNECTION = "AuthType=ClientSecret;Url=https://mono.crm.dynamics.com;ClientId=id;ClientSecret=secret";
const TENANT = "tenant-guid";

// type → { templateFolder, version to scaffold, per-type marker files }. Plugin uses the
// file-complete v1 template (v3's csproj comes from `pac plugin init`, e2e-covered); the
// copy+substitute path it exercises is the same one v3 runs for its own files.
interface TypeSpec {
  type: string;
  folder: string;
  version: number;
  markers: string[];
}
const TYPES: TypeSpec[] = [
  { type: "plugin", folder: "plugin", version: 1, markers: ["Plugin.sln", "plugins_src/plugins_src.csproj", "plugins_src/spkl.json"] },
  { type: "webresources", folder: "webresources", version: 1, markers: ["webpack.common.js", "webresources_src/library.ts", "tsconfig.build.json"] },
  { type: "solution", folder: "solution", version: 2, markers: ["paket.dependencies", "nuget.config", ".gitignore"] },
  { type: "portal", folder: "portal", version: 1, markers: ["tsconfig.json", "build/portalpublish.cmd", "paket.dependencies"] },
];

/** Mirror generateTemplates' copy+substitute: skip scaffold:false (on-demand Create-*
 * templates), rename .tstemplate → .ts, substitute SOLUTIONPREFIX/SOLUTIONPLACEHOLDER and
 * any declared placeholders so no raw token survives into a real project. */
function scaffold(destDir: string, spec: TypeSpec): void {
  const template = JSON.parse(fs.readFileSync(path.join(TEMPLATES, spec.folder, "template.json"), "utf8")).find((t: any) => t.version === spec.version);
  for (const f of template.files ?? []) {
    if (f.scaffold === false) {
      continue;
    }
    const ext = f.extension === ".tstemplate" ? ".ts" : f.extension;
    let data = fs.readFileSync(path.join(TEMPLATES, spec.folder, f.filename + f.extension, f.version + f.extension), "utf8");
    data = data.replace(/SOLUTIONPREFIX/g, PREFIX).replace(/SOLUTIONPLACEHOLDER/g, SOLUTION);
    for (const p of template.placeholders ?? []) {
      if (p.placeholder === "SOLUTIONPREFIX" || p.placeholder === "SOLUTIONPLACEHOLDER") {
        continue;
      }
      data = data.replace(new RegExp(p.placeholder, "g"), p.placeholder.toLowerCase());
    }
    const dest = path.join(destDir, ...(f.path ?? []), f.filename + ext);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data, "utf8");
  }
}

/** Every text file under a folder (templates are all text; no node_modules here). */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe("monorepo: two of every component type (#47/#119)", () => {
  let workspace = "";
  let components: DiscoveredComponent[] = [];
  // relativeRoot per (type, instance) e.g. instances["plugin"] = ["plugin-a", "plugin-b"].
  const instances: Record<string, string[]> = {};

  beforeAll(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt_mono_"));
    // Connection-only root (Empty): the connection + companions live here; components inherit.
    fs.writeFileSync(
      path.join(workspace, "dataverse-powertools.json"),
      JSON.stringify({ connectionString: CONNECTION, prefix: PREFIX, tenantId: TENANT, environmentLabel: "DEV", solutionName: SOLUTION }, null, 2),
    );

    for (const spec of TYPES) {
      instances[spec.type] = [];
      for (const suffix of ["a", "b"]) {
        const rel = `${spec.folder}-${suffix}`;
        instances[spec.type].push(rel);
        const root = path.join(workspace, rel);
        fs.mkdirSync(root, { recursive: true });
        scaffold(root, spec);
        // Component settings exactly as addComponent writes them post-fix: own type +
        // carried prefix (so template substitution ran), NO connectionString (inherits).
        fs.writeFileSync(
          path.join(root, "dataverse-powertools.json"),
          JSON.stringify({ type: spec.type, templateversion: spec.version, prefix: PREFIX, solutionName: SOLUTION }, null, 2),
        );
      }
    }

    // Discover exactly as the extension does: read every settings file off disk, resolve.
    const settingsFiles = walkFiles(workspace)
      .filter((f) => path.basename(f) === "dataverse-powertools.json")
      .map((f) => ({ path: f, content: fs.readFileSync(f, "utf8") }));
    components = resolveComponents(workspace, settingsFiles).components;
  });

  afterAll(() => {
    if (workspace && !process.env.DVPT_KEEP_PROJECT) {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  const componentOf = (rel: string) => components.find((c) => c.relativeRoot === rel) as DiscoveredComponent;
  const resolvedRel = (res: ReturnType<typeof resolveTargetComponent>) => (res.kind === "resolved" ? res.component.relativeRoot : res.kind);

  it("discovers the root plus two components of every type (9 total)", () => {
    expect(components).toHaveLength(1 + TYPES.length * 2);
    const roots = components.filter((c) => c.isRoot);
    expect(roots).toHaveLength(1);
    expect(roots[0].relativeRoot).toBe("");
    for (const spec of TYPES) {
      expect(componentsOfType(components, spec.type).map((c) => c.relativeRoot)).toEqual(instances[spec.type]);
    }
  });

  it("every component inherits the root connection and companions, and sets none of its own", () => {
    for (const spec of TYPES) {
      for (const rel of instances[spec.type]) {
        const settingsOnDisk = JSON.parse(fs.readFileSync(path.join(workspace, rel, "dataverse-powertools.json"), "utf8"));
        expect(settingsOnDisk.connectionString, `${rel} keeps no own connection`).toBeUndefined();
        const resolved = componentOf(rel);
        expect(resolved.settings.type, `${rel} type`).toBe(spec.type);
        expect(resolved.settings.connectionString, `${rel} inherits connection`).toBe(CONNECTION);
        expect(resolved.settings.tenantId, `${rel} inherits tenant`).toBe(TENANT);
        expect(resolved.settings.environmentLabel, `${rel} inherits env label`).toBe("DEV");
      }
    }
  });

  // ---- Commands target the right component (#119 resolveTargetComponent ladder) ----
  describe("command targeting", () => {
    for (const spec of TYPES) {
      it(`${spec.type}: disambiguates the two components by hint / active editor / picker`, () => {
        const [a, b] = instances[spec.type];
        const compA = componentOf(a);
        const compB = componentOf(b);

        // No hint, no active editor → ask, with exactly the two components of this type.
        const noContext = resolveTargetComponent(components, spec.type, undefined, undefined);
        expect(noContext.kind).toBe("pick");
        expect(noContext.kind === "pick" && noContext.candidates.map((c) => c.relativeRoot)).toEqual([a, b]);

        // Panel-card hint = a component root → that exact component.
        expect(resolvedRel(resolveTargetComponent(components, spec.type, compA.root, undefined))).toBe(a);

        // Explorer/CodeLens hint = a real scaffolded file inside B → B.
        const fileInB = path.join(compB.root, spec.markers[0]);
        expect(resolvedRel(resolveTargetComponent(components, spec.type, fileInB, undefined))).toBe(b);

        // Active editor inside B, no hint → B (not A).
        expect(resolvedRel(resolveTargetComponent(components, spec.type, undefined, fileInB))).toBe(b);
      });
    }

    it("does not leak targeting across types (a plugin file never resolves a webresources command)", () => {
      const pluginFile = path.join(componentOf(instances["plugin"][0]).root, "Plugin.sln");
      // Active editor is a plugin file; command is webresources with two candidates → still ask.
      const res = resolveTargetComponent(components, "webresources", undefined, pluginFile);
      expect(res.kind).toBe("pick");
      expect(res.kind === "pick" && res.candidates.map((c) => c.relativeRoot)).toEqual(instances["webresources"]);
    });

    it("a wrong-type explicit hint suppresses active-editor inference (user pointed elsewhere)", () => {
      const webFile = path.join(componentOf(instances["webresources"][0]).root, "webpack.common.js");
      const pluginActive = path.join(componentOf(instances["plugin"][1]).root, "Plugin.sln");
      // hint = a webresources file, command = plugin, active editor = plugin-b: the explicit
      // (wrong-type) hint blocks inference, so it asks among the plugins rather than picking plugin-b.
      expect(resolveTargetComponent(components, "plugin", webFile, pluginActive).kind).toBe("pick");
    });
  });

  // ---- Each component template is set up correctly ----
  describe("template setup", () => {
    for (const spec of TYPES) {
      for (const suffix of [0, 1]) {
        it(`${spec.type} #${suffix + 1}: scaffolds its marker files with no leftover template tokens`, () => {
          const root = path.join(workspace, instances[spec.type][suffix]);
          for (const marker of spec.markers) {
            expect(fs.existsSync(path.join(root, marker)), `${instances[spec.type][suffix]}/${marker} scaffolded`).toBe(true);
          }
          // No raw SOLUTIONPREFIX/SOLUTIONPLACEHOLDER (or other placeholder) survived substitution.
          for (const file of walkFiles(root)) {
            if (path.basename(file) === "dataverse-powertools.json") {
              continue;
            }
            const text = fs.readFileSync(file, "utf8");
            expect(text.includes("SOLUTIONPREFIX"), `${file} has no raw SOLUTIONPREFIX`).toBe(false);
            expect(text.includes("SOLUTIONPLACEHOLDER"), `${file} has no raw SOLUTIONPLACEHOLDER`).toBe(false);
          }
        });
      }
    }

    it("web resources: webpack output uses the real prefix and library.ts is the buildable stub", () => {
      for (const rel of instances["webresources"]) {
        const root = path.join(workspace, rel);
        const webpackCommon = fs.readFileSync(path.join(root, "webpack.common.js"), "utf8");
        expect(webpackCommon, `${rel} webpack uses ${PREFIX}_library.js`).toContain(`${PREFIX}_library.js`);
        const library = fs.readFileSync(path.join(root, "webresources_src", "library.ts"), "utf8");
        expect(library.includes('export * from "./account"'), `${rel} library.ts is not the demo barrel`).toBe(false);
        // scaffold:false on-demand templates must NOT be scaffolded into the project.
        expect(fs.existsSync(path.join(root, "webresources_src", "class.ts")), `${rel} has no stray class.ts`).toBe(false);
        expect(fs.existsSync(path.join(root, "webresources_src", "__tests__")), `${rel} has no scaffolded __tests__`).toBe(false);
      }
    });

    it("plugins: each carries its own project scaffold (sln + csproj) independently", () => {
      for (const rel of instances["plugin"]) {
        const root = path.join(workspace, rel);
        expect(fs.existsSync(path.join(root, "Plugin.sln")), `${rel} sln`).toBe(true);
        expect(fs.existsSync(path.join(root, "plugins_src", "plugins_src.csproj")), `${rel} csproj`).toBe(true);
      }
    });
  });
});
