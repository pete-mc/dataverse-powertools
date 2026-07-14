import { describe, it, expect } from "vitest";
import { earlyboundUsingLine, DEFAULT_EARLYBOUND_NAMESPACE } from "./earlyboundClassScaffold";

describe("earlyboundUsingLine", () => {
  it("emits an active using when generated types exist", () => {
    expect(earlyboundUsingLine("My.Project.Entities", true)).toBe("using My.Project.Entities;");
  });

  it("emits a commented hint (not an active using) when nothing has been generated", () => {
    const line = earlyboundUsingLine("My.Project.Entities", false);
    expect(line.startsWith("// using My.Project.Entities;")).toBe(true);
    // The critical property: no active using — that would be a CS0246 compile error before generation.
    expect(line.trimStart().startsWith("using ")).toBe(false);
  });

  it("falls back to the default namespace when none is configured", () => {
    expect(earlyboundUsingLine(undefined, true)).toBe(`using ${DEFAULT_EARLYBOUND_NAMESPACE};`);
    expect(earlyboundUsingLine("   ", true)).toBe(`using ${DEFAULT_EARLYBOUND_NAMESPACE};`);
  });
});
