import { describe, it, expect } from "vitest";
import { parseControlManifest } from "./controlManifest";

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
