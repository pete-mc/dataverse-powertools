import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  PREVIEW_FEATURES,
  PREVIEW_WHEN_CLAUSE,
  isPreviewCommand,
  isPreviewProjectType,
  previewFeatureForProjectType,
  visibleActions,
  visibleProjectTypes,
} from "./previewFeatures";
import { projectTypeRegistry } from "../projectTypes/registry";

const repoRoot = path.resolve(__dirname, "..", "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const contributedCommands: { command: string; enablement?: string }[] = packageJson.contributes.commands;

describe("preview feature registry", () => {
  it("declares the three release-gated features", () => {
    expect(PREVIEW_FEATURES.map((f) => f.id)).toEqual(["azureFunctions", "pluginDebugging", "customApis"]);
    for (const feature of PREVIEW_FEATURES) {
      expect(feature.label.length, `${feature.id}: needs a label`).toBeGreaterThan(0);
      expect(feature.note.length, `${feature.id}: needs a note`).toBeGreaterThan(0);
      expect(feature.manualTestIssue, `${feature.id}: needs a manual-test sign-off issue`).toBeGreaterThan(0);
      expect(feature.commands.length, `${feature.id}: needs at least one command`).toBeGreaterThan(0);
    }
  });

  it("claims each command exactly once", () => {
    const all = PREVIEW_FEATURES.flatMap((f) => [...f.commands]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("recognises preview commands and leaves the rest alone", () => {
    expect(isPreviewCommand("dataverse-powertools.capturePluginRun")).toBe(true);
    expect(isPreviewCommand("dataverse-powertools.invokeCustomApi")).toBe(true);
    expect(isPreviewCommand("dataverse-powertools.buildAndDeploy")).toBe(false);
    expect(isPreviewCommand(undefined)).toBe(false);
  });

  it("recognises preview project types", () => {
    expect(isPreviewProjectType("azurefunction")).toBe(true);
    expect(isPreviewProjectType("plugin")).toBe(false);
    expect(isPreviewProjectType(undefined)).toBe(false);
    expect(previewFeatureForProjectType("azurefunction")?.label).toBe("Azure Functions");
    expect(previewFeatureForProjectType("plugin")).toBeUndefined();
  });
});

describe("filters", () => {
  const actions = [{ command: "dataverse-powertools.buildProject" }, { command: "dataverse-powertools.newCustomApi" }];

  it("drops preview actions while the flag is off and keeps everything while on", () => {
    expect(visibleActions(actions, false).map((a) => a.command)).toEqual(["dataverse-powertools.buildProject"]);
    expect(visibleActions(actions, true)).toEqual(actions);
  });

  it("drops preview project types while the flag is off", () => {
    const off = visibleProjectTypes(projectTypeRegistry, false).map((d) => d.id);
    expect(off).not.toContain("azurefunction");
    expect(off).toContain("plugin");
    expect(visibleProjectTypes(projectTypeRegistry, true).length).toBe(projectTypeRegistry.length);
  });
});

// package.json can't read this module, so keep the two in lockstep in both directions:
// every preview command must be palette-gated on the setting, and nothing else may be.
describe("preview ↔ package.json parity", () => {
  const contributedPreview = PREVIEW_FEATURES.flatMap((f) => [...f.commands]).filter((id) => contributedCommands.some((c) => c.command === id));

  it("gates every contributed preview command's enablement on the setting", () => {
    const ungated = contributedPreview.filter((id) => !contributedCommands.find((c) => c.command === id)?.enablement?.includes(PREVIEW_WHEN_CLAUSE));
    expect(ungated, "preview commands whose package.json enablement is missing the previewFeatures gate").toEqual([]);
  });

  it("gates nothing else on the setting", () => {
    const gated = contributedCommands.filter((c) => c.enablement?.includes(PREVIEW_WHEN_CLAUSE)).map((c) => c.command);
    expect(
      gated.filter((id) => !contributedPreview.includes(id)),
      "package.json gates these on previewFeatures but PREVIEW_FEATURES doesn't own them",
    ).toEqual([]);
  });

  it("declares the previewFeatures + collapseCardsFrom settings", () => {
    const properties = packageJson.contributes.configuration.properties;
    expect(properties["dataverse-powertools.previewFeatures"].default).toBe(false);
    expect(properties["dataverse-powertools.collapseCardsFrom"].default).toBe(3);
  });

  it("owns only commands the project-type registry knows about (plus CodeLens-only ones)", () => {
    const registryCommands = new Set(projectTypeRegistry.flatMap((d) => [...d.commandIds]));
    const codeLensOnly = new Set(["dataverse-powertools.toggleStepProfilingAtLine"]);
    const unknown = PREVIEW_FEATURES.flatMap((f) => [...f.commands]).filter((id) => !registryCommands.has(id) && !codeLensOnly.has(id));
    expect(unknown, "preview commands that no project type owns").toEqual([]);
  });
});
