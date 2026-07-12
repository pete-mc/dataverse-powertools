/* eslint-disable @typescript-eslint/naming-convention -- fixture fields are Dataverse logical names */
import { describe, expect, it } from "vitest";
import { profileFileName, profilePickLabel } from "./downloadProfiles";

describe("profileFileName", () => {
  it("names by sanitized type + capture timestamp, xml-sniffed extension", () => {
    const name = profileFileName("Contoso.Plugins.AccountPlugin", "2026-07-12T03:04:05Z", "<ProfilerExecutionReport/>");
    expect(name).toMatch(/^Contoso\.Plugins\.AccountPlugin_\d{8}-\d{6}\.profile\.xml$/);
  });

  it("falls back safely on missing type/date and non-xml content", () => {
    const name = profileFileName(undefined, undefined, "AAAA-base64ish");
    expect(name).toBe("profile_unknown-time.profile");
  });

  it("strips path-hostile characters from the type name", () => {
    expect(profileFileName("Bad/Type:Name", "nope", "<x/>")).toMatch(/^Bad_Type_Name_unknown-time\.profile\.xml$/);
  });
});

describe("profilePickLabel", () => {
  it("labels by type with message/entity/mode/date detail", () => {
    const { label, description } = profilePickLabel({
      mbs_pluginprofileid: "id",
      mbs_typename: "Contoso.AccountPlugin",
      mbs_messagename: "Create",
      mbs_primaryentity: "account",
      mbs_mode: 0,
      createdon: "2026-07-12T03:04:05Z",
    });
    expect(label).toBe("Contoso.AccountPlugin");
    expect(description).toContain("Create · account · sync");
  });
});
