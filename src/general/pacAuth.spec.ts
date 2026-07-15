import { describe, it, expect } from "vitest";
import { AUTH_PROFILE_NAME, pacAuthCreateInteractiveArgs, pacAuthSelectArgs, pacAuthDeleteArgs, pacOrgSelectArgs, isPacAuthError, parseDeviceCode } from "./pacAuth";

describe("pacAuthCreateInteractiveArgs", () => {
  it("builds an interactive create for a named profile + environment", () => {
    expect(pacAuthCreateInteractiveArgs("dataverse-powertools", "https://org.crm.dynamics.com/")).toEqual([
      "auth",
      "create",
      "--name",
      "dataverse-powertools",
      "--environment",
      "https://org.crm.dynamics.com/",
    ]);
  });

  it("appends --deviceCode when opts.deviceCode is set", () => {
    expect(pacAuthCreateInteractiveArgs(AUTH_PROFILE_NAME, "https://org.crm.dynamics.com/", { deviceCode: true })).toEqual([
      "auth",
      "create",
      "--name",
      AUTH_PROFILE_NAME,
      "--environment",
      "https://org.crm.dynamics.com/",
      "--deviceCode",
    ]);
  });

  it("omits --deviceCode when opts.deviceCode is false", () => {
    expect(pacAuthCreateInteractiveArgs(AUTH_PROFILE_NAME, "https://org.crm.dynamics.com/", { deviceCode: false })).not.toContain("--deviceCode");
  });
});

describe("pacAuthSelectArgs", () => {
  it("builds auth select by profile name", () => {
    expect(pacAuthSelectArgs("dataverse-powertools")).toEqual(["auth", "select", "--name", "dataverse-powertools"]);
  });
});

describe("pacAuthDeleteArgs", () => {
  it("builds auth delete by profile name", () => {
    expect(pacAuthDeleteArgs("dataverse-powertools")).toEqual(["auth", "delete", "--name", "dataverse-powertools"]);
  });
});

describe("pacOrgSelectArgs", () => {
  it("builds org select for an environment", () => {
    expect(pacOrgSelectArgs("https://org.crm.dynamics.com/")).toEqual(["org", "select", "--environment", "https://org.crm.dynamics.com/"]);
  });
});

describe("isPacAuthError", () => {
  it.each([
    "No profiles were found on this computer.",
    "There is no active auth profile.",
    "The user is not authenticated.",
    "No active environment set for the current auth profile",
    "Please reauthenticate and try again.",
    "Please reauthentication is required.",
    "Unauthorized (401)",
    "Response status code does not indicate success: 401 (Unauthorized).",
    "AADSTS700082: The refresh token has expired.",
    "Your token has expired, sign in again.",
    "Access token expired.",
  ])("matches auth signature: %s", (text) => {
    expect(isPacAuthError(text)).toBe(true);
  });

  it.each(["The system cannot find the file specified.", "file not found", "MSBuild error CS1002: ; expected", "Build FAILED.", ""])(
    "does NOT match generic failure: %s",
    (text) => {
      expect(isPacAuthError(text)).toBe(false);
    },
  );
});

describe("parseDeviceCode", () => {
  it("extracts the code and url from pac's device-code prompt", () => {
    const line = "To sign in, use a web browser to open the page https://microsoft.com/devicelogin and enter the code ABCD-EFGH to authenticate.";
    expect(parseDeviceCode(line)).toEqual({ code: "ABCD-EFGH", url: "https://microsoft.com/devicelogin" });
  });

  it("returns undefined for a line without a device-code prompt", () => {
    expect(parseDeviceCode("Authenticating as user@contoso.com...")).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(parseDeviceCode("")).toBeUndefined();
  });
});
