import { describe, it, expect } from "vitest";
import { buildAttachDebugConfig } from "./debugConfig";

describe("buildAttachDebugConfig", () => {
  it("builds an msedge attach config on the given port", () => {
    const cfg = buildAttachDebugConfig("msedge", 9333);
    expect(cfg.type).toBe("msedge");
    expect(cfg.request).toBe("attach");
    expect(cfg.port).toBe(9333);
    expect(cfg.webRoot).toBe("${workspaceFolder}");
    expect(cfg.sourceMapPathOverrides).toBeDefined();
  });

  it("uses the chrome debug type for chrome", () => {
    expect(buildAttachDebugConfig("chrome", 1).type).toBe("chrome");
  });
});
