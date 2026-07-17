import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseControlManifest, findPcfProjectRoot, findControlDir } from "./controlManifest";

const fieldManifest = `<?xml version="1.0" encoding="utf-8" ?>
<manifest>
  <control namespace="Contoso" constructor="RatingControl" version="1.2.3" display-name-key="RatingControl_Display_Key" description-key="RatingControl_Desc_Key" control-type="standard">
    <property name="value" display-name-key="value_Display_Key" of-type="Whole.None" usage="bound" required="true" />
    <resources>
      <code path="index.ts" order="1" />
    </resources>
  </control>
</manifest>`;

const datasetReactManifest = `<?xml version="1.0" encoding="utf-8" ?>
<manifest>
  <control namespace="Contoso" constructor="GridControl" version="0.0.1" control-type="virtual">
    <data-set name="records" display-name-key="records_Display_Key" />
    <resources>
      <code path="index.ts" order="1" />
      <platform-library name="React" version="16.8.6" />
      <platform-library name="Fluent" version="9.46.2" />
    </resources>
  </control>
</manifest>`;

describe("parseControlManifest", () => {
  it("parses namespace, constructor, version and display-name-key from a field control", () => {
    const m = parseControlManifest(fieldManifest);
    expect(m).toBeTruthy();
    expect(m?.namespace).toBe("Contoso");
    expect(m?.constructor).toBe("RatingControl");
    expect(m?.version).toBe("1.2.3");
    expect(m?.displayNameKey).toBe("RatingControl_Display_Key");
  });

  it("infers template=field and framework=none for a plain property control", () => {
    const m = parseControlManifest(fieldManifest);
    expect(m?.template).toBe("field");
    expect(m?.framework).toBe("none");
  });

  it("infers template=dataset when a <data-set> is present", () => {
    const m = parseControlManifest(datasetReactManifest);
    expect(m?.template).toBe("dataset");
  });

  it("infers framework=react from a React platform-library (case-insensitive, among others)", () => {
    const m = parseControlManifest(datasetReactManifest);
    expect(m?.framework).toBe("react");
  });

  it("returns undefined for XML without a <control> element", () => {
    expect(parseControlManifest("<manifest></manifest>")).toBeUndefined();
    expect(parseControlManifest("<root><child/></root>")).toBeUndefined();
  });

  it("returns undefined for empty or non-manifest input", () => {
    expect(parseControlManifest("")).toBeUndefined();
    expect(parseControlManifest("not xml at all")).toBeUndefined();
  });

  it("returns undefined when namespace or constructor is missing", () => {
    const noCtor = `<manifest><control namespace="Contoso" version="1.0.0"></control></manifest>`;
    expect(parseControlManifest(noCtor)).toBeUndefined();
  });

  it("omits optional version/displayNameKey when absent", () => {
    const minimal = `<manifest><control namespace="N" constructor="C"><property name="v" /></control></manifest>`;
    const m = parseControlManifest(minimal);
    expect(m?.namespace).toBe("N");
    expect(m?.constructor).toBe("C");
    expect(m?.version).toBeUndefined();
    expect(m?.displayNameKey).toBeUndefined();
  });
});

// findPcfProjectRoot / findControlDir against the real `pac pcf init` layout: the manifest lives in
// a <Constructor>/ subfolder while package.json/.pcfproj/out/ sit at the project root (the split that
// caused a real bundle-path bug — verified live). Uses a throwaway tmp tree.
describe("findPcfProjectRoot vs findControlDir (#141 project-root split)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) {
      try {
        fs.rmSync(r, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  function scaffold(): string {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-pcf-"));
    roots.push(base);
    fs.writeFileSync(path.join(base, "package.json"), "{}");
    fs.writeFileSync(path.join(base, "MyControl.pcfproj"), "<Project/>");
    const controlDir = path.join(base, "HotReloadProbe");
    fs.mkdirSync(controlDir);
    fs.writeFileSync(path.join(controlDir, "ControlManifest.Input.xml"), "<manifest><control namespace='N' constructor='C'/></manifest>");
    return base;
  }

  it("finds the .pcfproj project root (not the nested manifest dir)", () => {
    const base = scaffold();
    expect(findPcfProjectRoot(base)).toBe(base);
  });

  it("findControlDir returns the nested manifest dir, which is NOT the project root", () => {
    const base = scaffold();
    const controlDir = findControlDir(base);
    expect(controlDir).toBe(path.join(base, "HotReloadProbe"));
    expect(controlDir).not.toBe(findPcfProjectRoot(base)); // the split the fix depends on
  });

  it("returns undefined when there is no .pcfproj", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-nopcf-"));
    roots.push(base);
    expect(findPcfProjectRoot(base)).toBeUndefined();
  });
});
