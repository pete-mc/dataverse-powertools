import { describe, it, expect } from "vitest";
import {
  AUTH_PROFILE_NAME,
  pacAuthCreateInteractiveArgs,
  pacAuthSelectArgs,
  pacAuthDeleteArgs,
  pacOrgSelectArgs,
  isPacAuthError,
  parseDeviceCode,
  pacOutputHasError,
  pacSucceeded,
  listHasNamedProfile,
  hasShellMetacharacters,
} from "./pacAuth";

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

describe("pacOutputHasError / pacSucceeded — pac exits 0 even on failure (#128/#129)", () => {
  // Real pac 2.8.1 output: these all returned exit code 0.
  const noProfiles = "Microsoft PowerPlatform CLI\nVersion: 2.8.1\n\nError: No profiles were found on this computer. Please run 'pac auth create' to create one.";
  const badName = 'Error: AuthProfileNameDoesNotExist\nThere is no authentication profile with name "dataverse-powertools"';
  const good = "Connected to... org32218dcd\nThe early bound classes were generated successfully.";

  it("detects pac's Error: banner in output", () => {
    expect(pacOutputHasError(noProfiles)).toBe(true);
    expect(pacOutputHasError(badName)).toBe(true);
    expect(pacOutputHasError(good)).toBe(false);
    expect(pacOutputHasError("")).toBe(false);
  });

  it("treats exit 0 with an Error banner as a FAILURE (the core bug)", () => {
    expect(pacSucceeded({ code: 0, stdout: noProfiles, stderr: "" })).toBe(false);
    expect(pacSucceeded({ code: 0, stdout: "", stderr: badName })).toBe(false);
    expect(pacSucceeded({ code: 0, stdout: good, stderr: "" })).toBe(true);
    // A non-zero exit is also a failure even without a banner.
    expect(pacSucceeded({ code: 1, stdout: "", stderr: "" })).toBe(false);
  });
});

describe("listHasNamedProfile — parse `pac auth list` (it exits 0 even with no profiles)", () => {
  it("is false when pac reports no profiles", () => {
    expect(listHasNamedProfile("No profiles were found on this computer. Please run 'pac auth create'.", "dataverse-powertools")).toBe(false);
  });
  it("is true only when the named profile appears in the list", () => {
    const list =
      "Index Active Kind      Name                 Friendly Name        Url\n[1]   *      UNIVERSAL      dataverse-powertools dataverse-powertools https://org.crm.dynamics.com";
    expect(listHasNamedProfile(list, "dataverse-powertools")).toBe(true);
    expect(listHasNamedProfile(list, "some-other-profile")).toBe(false);
  });
});

describe("hasShellMetacharacters — client-secret guard for the cmd.exe pac fallback (CodeQL #47)", () => {
  it("accepts real Azure client-secret shapes (base64url alphabet, never rejected)", () => {
    for (const secret of ["abc123XYZ~_.-", "Q~aBcD3fGhIjKlMnOpQrStUvWxYz0123456789.-_", "8Q~kLmNoP.qRsTuVwXyZ_-0123", "Zm9vYmFyMTIz+/=", "s3cr3t.value~with-dashes_and.dots"]) {
      expect(hasShellMetacharacters(secret), secret).toBe(false);
    }
  });

  it("rejects cmd.exe metacharacters that could break out of the fallback command line", () => {
    for (const bad of ["secret&whoami", "secret|calc", "secret>out.txt", "secret<in", "a^b", 'a"b', "50%off", "back`tick", "line1\nline2", "line1\rline2"]) {
      expect(hasShellMetacharacters(bad), bad).toBe(true);
    }
  });
});
