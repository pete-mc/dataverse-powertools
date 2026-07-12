/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect } from "vitest";
import { parseInstances } from "./globalDiscovery";

describe("parseInstances", () => {
  it("maps enabled instances to environments, sorted by friendly name", () => {
    const result = parseInstances({
      value: [
        { FriendlyName: "Prod", UniqueName: "orgprod", Url: "https://orgprod.crm.dynamics.com", State: 0 },
        { FriendlyName: "Dev", UniqueName: "orgdev", Url: "https://orgdev.crm.dynamics.com", State: 0 },
      ],
    });
    expect(result.map((e) => e.friendlyName)).toEqual(["Dev", "Prod"]);
    expect(result[0]).toEqual({ friendlyName: "Dev", uniqueName: "orgdev", url: "https://orgdev.crm.dynamics.com", environmentId: undefined });
  });

  it("carries the EnvironmentId through (Admin Center / Maker Portal links need it)", () => {
    const result = parseInstances({
      value: [{ FriendlyName: "Dev", UniqueName: "orgdev", Url: "https://orgdev.crm.dynamics.com", State: 0, EnvironmentId: "11111111-2222-3333-4444-555555555555" }],
    });
    expect(result[0].environmentId).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("drops disabled instances and ones without a url", () => {
    const result = parseInstances({
      value: [
        { FriendlyName: "Disabled", UniqueName: "orgx", Url: "https://orgx.crm.dynamics.com", State: 1 },
        { FriendlyName: "NoUrl", UniqueName: "orgy", State: 0 },
        { FriendlyName: "Good", UniqueName: "orgz", Url: "https://orgz.crm.dynamics.com", State: 0 },
      ],
    });
    expect(result.map((e) => e.uniqueName)).toEqual(["orgz"]);
  });

  it("falls back to unique name or url when there is no friendly name", () => {
    const result = parseInstances({ value: [{ UniqueName: "orgz", Url: "https://orgz.crm.dynamics.com", State: 0 }] });
    expect(result[0].friendlyName).toBe("orgz");
  });

  it("returns an empty array for a malformed or empty response", () => {
    expect(parseInstances(null)).toEqual([]);
    expect(parseInstances({})).toEqual([]);
    expect(parseInstances({ value: "nope" })).toEqual([]);
  });
});
