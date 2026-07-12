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

  it("maps webpack 5 namespace-prefixed source paths so breakpoints bind (user report)", () => {
    const cfg = buildAttachDebugConfig("msedge", 1, "C:/repo/web", "dvpt");
    expect(cfg.webRoot).toBe("C:/repo/web");
    // The bundle's inline map uses webpack://<library name>/./webresources_src/... —
    // without these exact overrides js-debug reports "unbound breakpoint".
    expect(cfg.sourceMapPathOverrides?.["webpack://dvpt/./*"]).toBe("C:/repo/web/*");
    expect(cfg.sourceMapPathOverrides?.["webpack://dvpt/*"]).toBe("C:/repo/web/*");
    expect(cfg.sourceMapPathOverrides?.["webpack://?:*/*"]).toBe("C:/repo/web/*");
    expect(cfg.sourceMapPathOverrides?.["webpack:///./*"]).toBe("C:/repo/web/*");
  });
});
