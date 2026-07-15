import { describe, it, expect, beforeEach } from "vitest";
import { beginPacOperation, setDeviceCodeSignIn, endPacOperation, getPacOperation, getDeviceCodeSignIn, resetPacActivity } from "./pacActivityState";
import type DataversePowerToolsContext from "../context";

function fakeContext(): { context: DataversePowerToolsContext; refreshes: () => number } {
  let refreshes = 0;
  const context = { refreshPanel: () => (refreshes += 1) } as unknown as DataversePowerToolsContext;
  return { context, refreshes: () => refreshes };
}

describe("pacActivityState", () => {
  beforeEach(() => resetPacActivity());

  it("begins with no operation or sign-in", () => {
    expect(getPacOperation()).toBeUndefined();
    expect(getDeviceCodeSignIn()).toBeUndefined();
  });

  it("beginPacOperation sets the busy label and re-renders", () => {
    const f = fakeContext();
    beginPacOperation(f.context, "Signing in to Power Platform CLI");
    expect(getPacOperation()).toEqual({ label: "Signing in to Power Platform CLI" });
    expect(getDeviceCodeSignIn()).toBeUndefined();
    expect(f.refreshes()).toBe(1);
  });

  it("setDeviceCodeSignIn surfaces the code + url and re-renders", () => {
    const f = fakeContext();
    beginPacOperation(f.context, "Signing in to Power Platform CLI");
    setDeviceCodeSignIn(f.context, { url: "https://microsoft.com/devicelogin", code: "ABCD-EFGH" });
    expect(getDeviceCodeSignIn()).toEqual({ url: "https://microsoft.com/devicelogin", code: "ABCD-EFGH" });
    // Operation label persists alongside the sign-in.
    expect(getPacOperation()).toEqual({ label: "Signing in to Power Platform CLI" });
    expect(f.refreshes()).toBe(2);
  });

  it("endPacOperation clears both operation and sign-in, and re-renders", () => {
    const f = fakeContext();
    beginPacOperation(f.context, "Signing in to Power Platform CLI");
    setDeviceCodeSignIn(f.context, { url: "https://microsoft.com/devicelogin", code: "ABCD-EFGH" });
    endPacOperation(f.context);
    expect(getPacOperation()).toBeUndefined();
    expect(getDeviceCodeSignIn()).toBeUndefined();
    expect(f.refreshes()).toBe(3);
  });

  it("beginPacOperation clears a stale device code from a previous run", () => {
    const f = fakeContext();
    setDeviceCodeSignIn(f.context, { url: "u", code: "OLD-CODE" });
    beginPacOperation(f.context, "Signing in to Power Platform CLI");
    expect(getDeviceCodeSignIn()).toBeUndefined();
  });

  it("tolerates a context without refreshPanel", () => {
    const context = {} as unknown as DataversePowerToolsContext;
    expect(() => beginPacOperation(context, "x")).not.toThrow();
    expect(getPacOperation()).toEqual({ label: "x" });
  });
});
