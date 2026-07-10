import { describe, it, expect } from "vitest";
import * as path from "path";
import { buildTypingsArgs } from "./generateTypings";

describe("buildTypingsArgs", () => {
  it("builds token-auth args with path.join paths and no client-secret/method flags", () => {
    const args = buildTypingsArgs({ toolDll: "/ext/tools/XrmDefinitelyTyped.dll", orgUrl: "https://org.crm.dynamics.com", solutionName: "dvpttests" });
    expect(args[0]).toBe("/ext/tools/XrmDefinitelyTyped.dll");
    expect(args).toContain("/url:https://org.crm.dynamics.com");
    expect(args).toContain(`/out:${path.join("typings", "XRM")}`);
    expect(args).toContain("/ss:dvpttests");
    expect(args).toContain(`/jsLib:${path.join("webresources_src", "lib")}`);
    expect(args).toContain("/w:dvpttestsWeb");
    expect(args).toContain("/r:dvpttestsRest");
    // Auth is via DVPT_TOKEN, so the legacy client-secret/method flags must be gone.
    expect(args.some((a) => a.startsWith("/method"))).toBe(false);
    expect(args.some((a) => a.includes("mfaClientSecret") || a.includes("mfaAppId"))).toBe(false);
  });

  it("adds a formintersect flag when configured", () => {
    const args = buildTypingsArgs({
      toolDll: "tool",
      orgUrl: "https://org",
      solutionName: "s",
      formIntersect: [{ name: "AccountIntersect", forms: [{ formId: "g1" }, { formId: "g2" }] }],
    });
    expect(args.find((a) => a.startsWith("/fi:"))).toBe("/fi:AccountIntersect: g1;g2");
  });

  it("omits the formintersect flag when none configured", () => {
    const args = buildTypingsArgs({ toolDll: "t", orgUrl: "u", solutionName: "s" });
    expect(args.some((a) => a.startsWith("/fi:"))).toBe(false);
  });
});
