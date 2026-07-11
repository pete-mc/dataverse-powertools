import { describe, it, expect } from "vitest";
import { canCallDataverseApi } from "./connectionReady";

describe("canCallDataverseApi", () => {
  it("is ready with a valid connection + org url (no tenantId needed — interactive/OAuth)", () => {
    // The whole point of the fix: an interactive connection has NO tenantId yet is fully usable.
    expect(canCallDataverseApi({ organizationUrl: "https://org.crm.dynamics.com", isValid: true })).toBe(true);
  });

  it("is not ready without a valid connection", () => {
    expect(canCallDataverseApi({ organizationUrl: "https://org.crm.dynamics.com", isValid: false })).toBe(false);
  });

  it("is not ready without an org url", () => {
    expect(canCallDataverseApi({ organizationUrl: "", isValid: true })).toBe(false);
    expect(canCallDataverseApi({ isValid: true })).toBe(false);
  });

  it("does not depend on any tenant id (the signature has no such field)", () => {
    // Guards must never re-introduce a tenantId requirement — pin that the predicate ignores it.
    const state = { organizationUrl: "https://org.crm.dynamics.com", isValid: true } as Record<string, unknown>;
    state.tenantId = "";
    expect(canCallDataverseApi(state)).toBe(true);
  });
});
