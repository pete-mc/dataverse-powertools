import { describe, it, expect } from "vitest";
import * as path from "path";
import { workspaceFilePath } from "./paths";

describe("workspaceFilePath", () => {
  it("joins root and filename as a proper path (not string concatenation)", () => {
    const result = workspaceFilePath("/workspace/project", "dataverse-powertools.json");
    // Cross-platform assertions: it's a real join, so basename/dirname round-trip.
    expect(path.basename(result)).toBe("dataverse-powertools.json");
    expect(result).toBe(path.join("/workspace/project", "dataverse-powertools.json"));
  });

  it("does not mash root and name into one segment (the old bug)", () => {
    const result = workspaceFilePath("/workspace/project", "settings.json");
    // The old `root + "\\" + name` on POSIX produced "project\settings.json" as a
    // single basename; a correct join keeps them as separate path segments.
    expect(path.dirname(result)).toBe(path.join("/workspace/project"));
    expect(path.basename(result)).not.toContain("\\");
  });

  it("supports nested segments", () => {
    const result = workspaceFilePath("/root", "sub", "file.txt");
    expect(result).toBe(path.join("/root", "sub", "file.txt"));
  });
});
