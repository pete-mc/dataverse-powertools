import { describe, it, expect } from "vitest";
import { pcfHarnessCommand } from "./runHarness";

describe("pcfHarnessCommand", () => {
  it("is the pcf-scripts watch harness command", () => {
    expect(pcfHarnessCommand()).toBe("npm start watch");
  });
});
