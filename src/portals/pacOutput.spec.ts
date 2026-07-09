import { describe, it, expect } from "vitest";
import { parsePacAuthList, parsePacPagesList, findAuthProfileForUrl, parsePacTable } from "./pacOutput";

// Real `pac auth list` output captured from pac 2.8.1. Note two things that broke the
// old whitespace-splitting parser: the "Name" cell is empty for the first profile, and
// the "Environment" cell of the second is a display name WITH SPACES ("Peter McDonald's
// Environment") sitting right before the Environment Url column.
const REAL_AUTH_LIST = [
  "Index Active Kind      Name              User                                 Cloud  Type            Environment                  Environment Url",
  "[1]          UNIVERSAL                   Peter.Mcdonald@nrmmrrd.qld.gov.au    Public OperatingSystem                              ",
  "[2]   *      UNIVERSAL dvpt-portal-probe f906614e-e545-4be0-a5e6-e802941fb305 Public Application     Peter McDonald's Environment https://org32218dcd.crm11.dynamics.com/",
  "",
].join("\r\n");

describe("parsePacAuthList", () => {
  it("parses every profile including empty and space-containing cells", () => {
    const profiles = parsePacAuthList(REAL_AUTH_LIST);
    expect(profiles).toHaveLength(2);

    expect(profiles[0]).toEqual({ index: 1, active: false, name: "", environmentUrl: "" });
    expect(profiles[1]).toEqual({
      index: 2,
      active: true,
      name: "dvpt-portal-probe",
      environmentUrl: "https://org32218dcd.crm11.dynamics.com/",
    });
  });

  it("returns [] when there is no table (e.g. an error message)", () => {
    expect(parsePacAuthList("Error: not authenticated")).toEqual([]);
  });
});

describe("findAuthProfileForUrl", () => {
  const profiles = parsePacAuthList(REAL_AUTH_LIST);

  it("matches the profile for a url ignoring scheme and trailing slash", () => {
    const match = findAuthProfileForUrl(profiles, "https://org32218dcd.crm11.dynamics.com");
    expect(match?.name).toBe("dvpt-portal-probe");
  });

  it("matches when the connection string host has no scheme", () => {
    const match = findAuthProfileForUrl(profiles, "org32218dcd.crm11.dynamics.com");
    expect(match?.name).toBe("dvpt-portal-probe");
  });

  it("returns undefined when no profile matches", () => {
    expect(findAuthProfileForUrl(profiles, "https://other.crm.dynamics.com")).toBeUndefined();
  });
});

describe("parsePacPagesList", () => {
  it("parses website id and friendly name (friendly names may contain spaces)", () => {
    const output = [
      "Connected as f906614e-e545-4be0-a5e6-e802941fb305",
      "Connected to... Contoso Environment",
      "",
      "Index Name              WebSiteId                            Data Model",
      "[1]   Contoso Marketing d44574f9-acc3-4ccc-8d8d-85cf5b7ad141 Enhanced",
      "[2]   Support Site      a1b2c3d4-1111-2222-3333-444455556666 Standard",
      "",
    ].join("\r\n");

    const pages = parsePacPagesList(output);
    expect(pages).toEqual([
      { websiteId: "d44574f9-acc3-4ccc-8d8d-85cf5b7ad141", friendlyName: "Contoso Marketing" },
      { websiteId: "a1b2c3d4-1111-2222-3333-444455556666", friendlyName: "Support Site" },
    ]);
  });

  it("tolerates the 'Friendly Name' / 'Website Id' header spellings", () => {
    // Built with padEnd so header labels and data cells share exact column offsets.
    const header = "Index".padEnd(6) + "Website Id".padEnd(37) + "Friendly Name";
    const row = "[1]".padEnd(6) + "d44574f9-acc3-4ccc-8d8d-85cf5b7ad141".padEnd(37) + "My Portal";
    const output = [header, row, ""].join("\r\n");
    expect(parsePacPagesList(output)).toEqual([{ websiteId: "d44574f9-acc3-4ccc-8d8d-85cf5b7ad141", friendlyName: "My Portal" }]);
  });

  it("returns [] when no websites exist", () => {
    expect(parsePacPagesList("No Power Pages website records exist")).toEqual([]);
  });
});

describe("parsePacTable", () => {
  it("skips headers that are not present rather than misaligning the rest", () => {
    const output = ["Index Name    Value", "[1]   Alpha   100", ""].join("\r\n");
    const rows = parsePacTable(output, ["Index", "Name", "Missing", "Value"]);
    // Rows are keyed by pac's literal (PascalCase) header names.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    expect(rows).toEqual([{ Index: "[1]", Name: "Alpha", Value: "100" }]);
  });
});
