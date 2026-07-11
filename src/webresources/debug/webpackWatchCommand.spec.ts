import { describe, it, expect } from "vitest";
import { WEBPACK_WATCH_LAUNCHER, WEBPACK_WATCH_ARGS } from "./debugWebresources";

describe("debug webpack --watch launcher", () => {
  // Regression guard: the debug session's watch build must also go through `npx` for the LOCAL
  // webpack (same bare-`webpack` failure as the one-shot build, masked by the e2e VM's global).
  it("launches webpack via npx with the watch config", () => {
    expect(WEBPACK_WATCH_LAUNCHER).toBe("npx");
    expect(WEBPACK_WATCH_ARGS[0]).toBe("webpack");
    expect(WEBPACK_WATCH_ARGS).toEqual(["webpack", "--config", "webpack.dev.js", "--watch"]);
  });
});
