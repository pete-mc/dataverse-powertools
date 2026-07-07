import { describe, it, expect } from "vitest";
import { pacAuthCreateArgs, pacAuthDeleteArgs, pacSolutionPackArgs, pacSolutionUnpackArgs, pacSolutionExportArgs, pacSolutionImportArgs } from "./pacArgs";
import { SolutionConfig } from "./solutionConfig";

const bothConfig: SolutionConfig = { uniqueName: "MySolution", packagePath: "src/MySolution", zipPath: "bin/MySolution.zip", packageType: "Both" };
const unmanagedConfig: SolutionConfig = { ...bothConfig, packageType: "Unmanaged" };

describe("pacAuthCreateArgs / pacAuthDeleteArgs", () => {
  it("builds a service-principal auth create command", () => {
    const args = pacAuthCreateArgs({
      profileName: "dataverse-powertools",
      applicationId: "app-1",
      clientSecret: "s3cr3t",
      tenantId: "tenant-9",
      environmentUrl: "https://org.crm.dynamics.com",
    });
    expect(args).toEqual([
      "auth",
      "create",
      "--name",
      "dataverse-powertools",
      "--applicationId",
      "app-1",
      "--clientSecret",
      "s3cr3t",
      "--tenant",
      "tenant-9",
      "--environment",
      "https://org.crm.dynamics.com",
    ]);
  });

  it("builds an auth delete command", () => {
    expect(pacAuthDeleteArgs("dataverse-powertools")).toEqual(["auth", "delete", "--name", "dataverse-powertools"]);
  });
});

describe("pacSolutionPackArgs", () => {
  it("packs a Both folder as Unmanaged by default and Managed on request", () => {
    expect(pacSolutionPackArgs(bothConfig)).toEqual(["solution", "pack", "--zipfile", "bin/MySolution.zip", "--folder", "src/MySolution", "--packagetype", "Unmanaged"]);
    expect(pacSolutionPackArgs(bothConfig, true)).toEqual([
      "solution",
      "pack",
      "--zipfile",
      "bin/MySolution_managed.zip",
      "--folder",
      "src/MySolution",
      "--packagetype",
      "Managed",
    ]);
  });

  it("honours a single package type", () => {
    expect(pacSolutionPackArgs(unmanagedConfig)).toContain("Unmanaged");
  });
});

describe("pacSolutionUnpackArgs", () => {
  it("unpacks into the package folder with the configured type and allowDelete", () => {
    expect(pacSolutionUnpackArgs(bothConfig)).toEqual([
      "solution",
      "unpack",
      "--zipfile",
      "bin/MySolution.zip",
      "--folder",
      "src/MySolution",
      "--packagetype",
      "Both",
      "--allowDelete",
    ]);
  });
});

describe("pacSolutionExportArgs", () => {
  it("exports unmanaged to the base zip path by default", () => {
    expect(pacSolutionExportArgs(bothConfig, { managed: false, environmentUrl: "https://org.crm.dynamics.com" })).toEqual([
      "solution",
      "export",
      "--path",
      "bin/MySolution.zip",
      "--name",
      "MySolution",
      "--managed",
      "false",
      "--overwrite",
      "true",
      "--environment",
      "https://org.crm.dynamics.com",
    ]);
  });

  it("exports managed to an explicit zip path when provided (the Both second pass)", () => {
    const args = pacSolutionExportArgs(bothConfig, { managed: true, environmentUrl: "https://org.crm.dynamics.com", zipPath: "bin/MySolution_managed.zip" });
    expect(args).toContain("bin/MySolution_managed.zip");
    expect(args.slice(args.indexOf("--managed"))).toContain("true");
  });
});

describe("pacSolutionImportArgs", () => {
  it("imports the unmanaged zip and publishes", () => {
    expect(pacSolutionImportArgs(bothConfig, "https://org.crm.dynamics.com")).toEqual([
      "solution",
      "import",
      "--path",
      "bin/MySolution.zip",
      "--environment",
      "https://org.crm.dynamics.com",
      "--publish-changes",
      "true",
    ]);
  });
});
