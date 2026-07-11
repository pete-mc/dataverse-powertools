import { describe, it, expect } from "vitest";
import { pacPagesListArgs, pacPagesDownloadArgs, pacPagesUploadArgs } from "./pacPagesArgs";

describe("pac pages args", () => {
  it("lists sites", () => {
    expect(pacPagesListArgs()).toEqual(["pages", "list"]);
  });

  it("downloads a site by id into a path", () => {
    expect(pacPagesDownloadArgs({ websiteId: "site-1", path: "C:/repo/portalpublish" })).toEqual(["pages", "download", "--webSiteId", "site-1", "--path", "C:/repo/portalpublish"]);
  });

  it("passes the enhanced data model and overwrite when requested", () => {
    expect(pacPagesDownloadArgs({ websiteId: "s", path: "p", modelVersion: 2, overwrite: true })).toEqual([
      "pages",
      "download",
      "--webSiteId",
      "s",
      "--path",
      "p",
      "--modelVersion",
      "2",
      "--overwrite",
    ]);
  });

  it("uploads from a path with optional model version", () => {
    expect(pacPagesUploadArgs({ path: "p" })).toEqual(["pages", "upload", "--path", "p"]);
    expect(pacPagesUploadArgs({ path: "p", modelVersion: 2 })).toEqual(["pages", "upload", "--path", "p", "--modelVersion", "2"]);
  });
});
