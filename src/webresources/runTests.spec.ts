import { describe, expect, it } from "vitest";
import { WEBRESOURCE_TEST_COMMAND } from "./runTests";

describe("WEBRESOURCE_TEST_COMMAND", () => {
  // Same trap as the webpack build: a bare `jest` only resolves a GLOBAL install,
  // which the extension never creates — the template installs jest as a local
  // devDependency, so the command must go through `npx`.
  it("runs the project's local jest via npx", () => {
    expect(WEBRESOURCE_TEST_COMMAND.startsWith("npx ")).toBe(true);
    expect(WEBRESOURCE_TEST_COMMAND).toContain("jest");
    expect(WEBRESOURCE_TEST_COMMAND).not.toMatch(/^jest\b/);
  });
});
