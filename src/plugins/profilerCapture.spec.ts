import { describe, it, expect } from "vitest";
import { stepPickLabel } from "./profilerCapture";

describe("profiler step pick label (#63 capture)", () => {
  it("labels by type with message · entity · mode · step name", () => {
    expect(stepPickLabel({ stepId: "s", name: "Create Contact step", typeName: "Contoso.ContactPlugin", message: "Create", primaryEntity: "contact", mode: 0 })).toEqual({
      label: "Contoso.ContactPlugin",
      description: "Create · contact · sync · Create Contact step",
    });
  });

  it("marks async mode and tolerates missing fields", () => {
    expect(stepPickLabel({ stepId: "s", name: "", typeName: "X.Y", mode: 1 })).toEqual({ label: "X.Y", description: "async" });
  });
});
