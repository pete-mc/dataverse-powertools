import { describe, expect, it } from "vitest";
import { planNestedMigrationMoves, splitSettingsForNestedMigration } from "./nestedMigration";

describe("planNestedMigrationMoves", () => {
  it("moves project files but keeps workspace-level entries at the root", () => {
    const moves = planNestedMigrationMoves([".git", ".vscode", "dataverse-powertools.json", "package.json", "webresources_src", "node_modules", "tsconfig.json"], "webresources");
    expect(moves).toEqual(["package.json", "webresources_src", "node_modules", "tsconfig.json"]);
  });

  it("never moves the destination folder into itself", () => {
    const moves = planNestedMigrationMoves(["webresources", "package.json"], "webresources");
    expect(moves).toEqual(["package.json"]);
  });
});

describe("splitSettingsForNestedMigration", () => {
  const settings = {
    type: "webresources",
    templateversion: 3,
    connectionString: "AuthType=OAuth;Url=https://org.crm.dynamics.com;",
    tenantId: "tenant-guid",
    prefix: "dvpt",
    solutionName: "TestSolution",
    environmentLabel: "Dev",
    settingsVersion: 1,
    webresourceOutput: "perFile",
  };

  it("keeps the connection on the root and strips it from the component", () => {
    const { rootSettings, componentSettings } = splitSettingsForNestedMigration(settings);
    expect(rootSettings.connectionString).toBe(settings.connectionString);
    expect(rootSettings.tenantId).toBe("tenant-guid");
    expect(rootSettings.prefix).toBe("dvpt");
    expect(rootSettings.environmentLabel).toBe("Dev");
    expect(componentSettings.connectionString).toBeUndefined();
    expect(componentSettings.tenantId).toBeUndefined();
    expect(componentSettings.prefix).toBeUndefined();
  });

  it("moves the type and project-specific fields to the component, with no type on the root", () => {
    const { rootSettings, componentSettings } = splitSettingsForNestedMigration(settings);
    expect(componentSettings.type).toBe("webresources");
    expect(componentSettings.templateversion).toBe(3);
    expect(componentSettings.webresourceOutput).toBe("perFile");
    expect(rootSettings.type).toBeUndefined();
    expect(rootSettings.webresourceOutput).toBeUndefined();
  });

  it("keeps solutionName and settingsVersion on both sides", () => {
    const { rootSettings, componentSettings } = splitSettingsForNestedMigration(settings);
    expect(rootSettings.solutionName).toBe("TestSolution");
    expect(componentSettings.solutionName).toBe("TestSolution");
    expect(rootSettings.settingsVersion).toBe(1);
    expect(componentSettings.settingsVersion).toBe(1);
  });

  it("drops undefined values instead of writing them", () => {
    const { rootSettings, componentSettings } = splitSettingsForNestedMigration({ type: "plugins", tenantId: undefined });
    expect("tenantId" in rootSettings).toBe(false);
    expect(componentSettings.type).toBe("plugins");
  });
});
