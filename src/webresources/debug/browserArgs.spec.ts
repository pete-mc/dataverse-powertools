import { describe, it, expect } from "vitest";
import { buildBrowserArgs } from "./browserArgs";

describe("buildBrowserArgs", () => {
  it("builds the CDP + persistent-profile launch args with the url last", () => {
    const args = buildBrowserArgs({ port: 9333, userDataDir: "C:\\profiles\\dvpt", url: "https://org.crm.dynamics.com" });
    expect(args).toEqual([
      "--remote-debugging-port=9333",
      "--user-data-dir=C:\\profiles\\dvpt",
      "--no-first-run",
      "--no-default-browser-check",
      "--new-window",
      "https://org.crm.dynamics.com",
    ]);
  });
});
