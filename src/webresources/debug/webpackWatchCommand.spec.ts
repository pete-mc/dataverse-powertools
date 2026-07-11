import { describe, it, expect } from "vitest";
import { WEBPACK_WATCH_LAUNCHER, WEBPACK_WATCH_ARGS } from "./debugWebresources";

describe("debug webpack --watch launcher", () => {
  // Regression guard: the debug session's watch build must also go through `npx` for the LOCAL
  // webpack (same bare-`webpack` failure as the one-shot build, masked by the e2e VM's global).
  it("launches webpack via npx with the watch config and reliable source maps", () => {
    expect(WEBPACK_WATCH_LAUNCHER).toBe("npx");
    expect(WEBPACK_WATCH_ARGS[0]).toBe("webpack");
    // --devtool inline-source-map: browser breakpoints must BIND to the TS even
    // for projects whose webpack.dev.js still says eval-source-map (#96).
    expect(WEBPACK_WATCH_ARGS).toEqual(["webpack", "--config", "webpack.dev.js", "--watch", "--devtool", "inline-source-map"]);
  });
});
