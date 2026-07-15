import { describe, it, expect } from "vitest";
import { classifyPortalFile, planPortalBuild } from "./portalBuildPlan";

describe("classifyPortalFile", () => {
  it("classifies by the nearest role segment", () => {
    expect(classifyPortalFile("portal/src/frontend/main.ts")).toBe("frontend");
    expect(classifyPortalFile("portal/src/backend/getWidgets.ts")).toBe("backend");
    expect(classifyPortalFile("portal/src/shared/models.ts")).toBe("shared");
    expect(classifyPortalFile("portal/src/other/x.ts")).toBe("other");
  });

  it("handles Windows separators", () => {
    expect(classifyPortalFile("portal\\src\\backend\\post.ts")).toBe("backend");
  });
});

describe("planPortalBuild", () => {
  it("splits frontend and backend entries, ignoring shared/other", () => {
    const plan = planPortalBuild(["p/src/frontend/main.ts", "p/src/frontend/widget.tsx", "p/src/backend/getWidgets.ts", "p/src/shared/models.ts", "p/src/other/util.ts"]);
    expect(plan.frontend).toEqual(["p/src/frontend/main.ts", "p/src/frontend/widget.tsx"]);
    expect(plan.backend).toEqual(["p/src/backend/getWidgets.ts"]);
  });

  it("skips .d.ts, spec, and test files", () => {
    const plan = planPortalBuild([
      "p/src/frontend/main.ts",
      "p/src/frontend/types.d.ts",
      "p/src/backend/getWidgets.ts",
      "p/src/backend/getWidgets.spec.ts",
      "p/src/backend/post.test.ts",
    ]);
    expect(plan.frontend).toEqual(["p/src/frontend/main.ts"]);
    expect(plan.backend).toEqual(["p/src/backend/getWidgets.ts"]);
  });

  it("is empty when there are no frontend/backend sources", () => {
    expect(planPortalBuild(["p/src/shared/models.ts", "p/readme.md.ts"])).toEqual({ frontend: [], backend: [] });
  });
});
