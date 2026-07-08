import { describe, it, expect } from "vitest";
import { formatThumbprint } from "./certificate";

describe("formatThumbprint", () => {
  it("strips the colons from an X.509 fingerprint and uppercases it", () => {
    expect(formatThumbprint("e9:fb:66:7e:d3:5e:89:87:de:bf:43:4c:35:b9:85:8d:da:83:1b:bd")).toBe("E9FB667ED35E8987DEBF434C35B9858DDA831BBD");
  });

  it("leaves an already-bare hex thumbprint unchanged", () => {
    expect(formatThumbprint("E9FB667ED35E8987DEBF434C35B9858DDA831BBD")).toBe("E9FB667ED35E8987DEBF434C35B9858DDA831BBD");
  });

  it("handles empty / missing input", () => {
    expect(formatThumbprint("")).toBe("");
    expect(formatThumbprint(undefined)).toBe("");
    expect(formatThumbprint(null)).toBe("");
  });
});
