import { describe, expect, it } from "vitest";
import { adminCenterUrl, makerPortalUrl } from "./openPortals";

const environmentId = "11111111-2222-3333-4444-555555555555";

describe("portal urls", () => {
  it("builds the Admin Center environment hub url", () => {
    expect(adminCenterUrl(environmentId)).toBe(`https://admin.powerplatform.microsoft.com/environments/environment/${environmentId}/hub`);
  });

  it("builds the Maker Portal environment home url", () => {
    expect(makerPortalUrl(environmentId)).toBe(`https://make.powerapps.com/environments/${environmentId}/home`);
  });
});
