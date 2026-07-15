import { describe, it, expect } from "vitest";
import { clock, buildProjectCard, ProjectCardFsInfo } from "./panelCards";
import { ComponentSettings } from "../components/discovery";

const noFs: ProjectCardFsInfo = { hasSpkl: false, downloadedProfiles: undefined, captureSupported: undefined };

describe("clock", () => {
  it("returns empty string for undefined", () => {
    expect(clock(undefined)).toBe("");
  });

  it("formats a timestamp as HH:MM (24h or 12h locale-dependent, always non-empty)", () => {
    // Use a fixed epoch; assert the shape rather than the exact locale rendering.
    const out = clock(Date.UTC(2020, 0, 1, 9, 5));
    expect(out).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("buildProjectCard", () => {
  it("prefers solutionName for the card name", () => {
    const settings = { type: "webresource", solutionName: "MySolution", pluginProjectName: "MyPlugin" } as unknown as ComponentSettings;
    expect(buildProjectCard(settings, "/root", "sub", false, noFs).name).toBe("MySolution");
  });

  it("falls back solutionName → pluginProjectName → relativeRoot → ''", () => {
    expect(buildProjectCard({ type: "plugin", pluginProjectName: "MyPlugin" } as unknown as ComponentSettings, "/r", "sub", false, noFs).name).toBe("MyPlugin");
    expect(buildProjectCard({ type: "plugin" } as unknown as ComponentSettings, "/r", "sub", false, noFs).name).toBe("sub");
    expect(buildProjectCard({ type: "plugin" } as unknown as ComponentSettings, "/r", "", false, noFs).name).toBe("");
  });

  it("sets a .csproj detail only when there is a plugin project name", () => {
    expect(buildProjectCard({ type: "plugin", pluginProjectName: "Acme" } as unknown as ComponentSettings, "/r", "", true, noFs).detail).toBe("Acme.csproj");
    expect(buildProjectCard({ type: "webresource" } as unknown as ComponentSettings, "/r", "", true, noFs).detail).toBeUndefined();
  });

  it("defaults an empty type to '' and coerces the unit-testing flag to boolean", () => {
    const card = buildProjectCard({ pluginUnitTestingEnabled: 1 } as unknown as ComponentSettings, "/r", "", true, noFs);
    expect(card.type).toBe("");
    expect(card.hasPluginUnitTesting).toBe(true);
  });

  it("passes through the fs/OS facts verbatim", () => {
    const fsInfo: ProjectCardFsInfo = { hasSpkl: true, downloadedProfiles: 3, captureSupported: true };
    const card = buildProjectCard({ type: "plugin" } as unknown as ComponentSettings, "/r", "", true, fsInfo);
    expect(card.hasSpkl).toBe(true);
    expect(card.downloadedProfiles).toBe(3);
    expect(card.captureSupported).toBe(true);
  });

  it("carries the azure-function trigger through (#145)", () => {
    const card = buildProjectCard({ type: "azurefunction", azureFunctionTrigger: "webhook" } as unknown as ComponentSettings, "/r", "", true, noFs);
    expect(card.azureFunctionTrigger).toBe("webhook");
  });
});
