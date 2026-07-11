import { describe, it, expect } from "vitest";
import { WEBRESOURCE_BUILD_COMMAND } from "./webpackBuild";

describe("WEBRESOURCE_BUILD_COMMAND", () => {
  // Regression guard: the build must run through `npx` so the project's LOCAL webpack is used. A
  // bare `webpack` fails with "'webpack' is not recognized" wherever there is no global install.
  // The e2e VM has a global webpack that masks this, so it can only be caught here.
  it("invokes webpack via npx (never a bare `webpack`)", () => {
    expect(WEBRESOURCE_BUILD_COMMAND.startsWith("npx ")).toBe(true);
    expect(WEBRESOURCE_BUILD_COMMAND).toContain("webpack --config webpack.dev.js");
    expect(WEBRESOURCE_BUILD_COMMAND).not.toMatch(/^webpack\b/);
  });
});
