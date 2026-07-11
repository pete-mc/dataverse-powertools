import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { projectTypeRegistry, getProjectTypeDescriptor, isSupportedProjectType, getTemplateFolderForType, ProjectTypes } from "./registry";
import { WALKTHROUGH_ID } from "../panel/menuModel";

// package.json contributions are static and can't read the registry, so this
// suite enforces parity between the two (#47/#100): a project type's commands,
// context key, and templates must agree with what package.json declares, in
// both directions. If this fails, one side was updated without the other.

const repoRoot = path.resolve(__dirname, "..", "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const contributedCommands: { command: string; enablement?: string }[] = packageJson.contributes.commands;
const contributedIds = new Set(contributedCommands.map((c) => c.command));

/** True when the enablement expression references the context key non-negated.
 * Word-boundary matters: isPlugin must not match isPluginV3. */
function referencesContextKey(expression: string | undefined, contextKey: string): boolean {
  if (!expression) {
    return false;
  }
  const re = new RegExp(`(!?)dataverse-powertools\\.${contextKey}(?![A-Za-z])`, "g");
  let match;
  while ((match = re.exec(expression)) !== null) {
    if (match[1] !== "!") {
      return true;
    }
  }
  return false;
}

describe("project type registry", () => {
  it("has unique ids, context keys and command ownership", () => {
    const ids = projectTypeRegistry.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);

    const contextKeys = projectTypeRegistry.map((d) => d.contextKey);
    expect(new Set(contextKeys).size).toBe(contextKeys.length);

    const allCommands = projectTypeRegistry.flatMap((d) => [...d.commandIds]);
    expect(new Set(allCommands).size).toBe(allCommands.length);

    for (const d of projectTypeRegistry) {
      expect(d.displayName.length).toBeGreaterThan(0);
    }
  });

  it("resolves descriptors by id and rejects unknown types", () => {
    expect(getProjectTypeDescriptor("plugin")?.id).toBe(ProjectTypes.plugin);
    expect(getProjectTypeDescriptor("webresources")?.id).toBe(ProjectTypes.webresource);
    expect(getProjectTypeDescriptor("nope")).toBeUndefined();
    expect(isSupportedProjectType("solution")).toBe(true);
    expect(isSupportedProjectType(undefined)).toBe(false);
    expect(getTemplateFolderForType("portal")).toBe("portal");
    expect(getTemplateFolderForType("legacy-custom")).toBe("legacy-custom");
    expect(getTemplateFolderForType(undefined)).toBeUndefined();
  });
});

describe("registry ↔ package.json parity", () => {
  it("declares every registry command in contributes.commands", () => {
    for (const d of projectTypeRegistry) {
      const missing = d.commandIds.filter((id) => !contributedIds.has(id));
      expect(missing, `${d.id}: commands missing from package.json contributes.commands`).toEqual([]);
    }
  });

  it("lists every type-gated package.json command in the owning descriptor", () => {
    for (const d of projectTypeRegistry) {
      const gated = contributedCommands.filter((c) => referencesContextKey(c.enablement, d.contextKey)).map((c) => c.command);
      const unregistered = gated.filter((id) => !d.commandIds.includes(id));
      expect(unregistered, `${d.id}: package.json gates these on ${d.contextKey} but the registry doesn't own them`).toEqual([]);
    }
  });

  it("references only contributed commands from viewsWelcome links", () => {
    const welcome: { contents: string }[] = packageJson.contributes.viewsWelcome;
    const linked = welcome.flatMap((w) => [...w.contents.matchAll(/command:(dataverse-powertools\.[A-Za-z]+)/g)].map((m) => m[1]));
    const missing = [...new Set(linked)].filter((id) => !contributedIds.has(id));
    expect(missing, "viewsWelcome links to commands that package.json never declares").toEqual([]);
  });

  it("has a scaffold template for every type's default version", () => {
    for (const d of projectTypeRegistry) {
      const templateFile = path.join(repoRoot, "templates", d.templateFolder, "template.json");
      expect(fs.existsSync(templateFile), `${d.id}: missing ${templateFile}`).toBe(true);
      const versions = (JSON.parse(fs.readFileSync(templateFile, "utf8")) as { version: number }[]).map((t) => t.version);
      expect(versions, `${d.id}: templates/${d.templateFolder}/template.json lacks version ${d.defaultTemplateVersion}`).toContain(d.defaultTemplateVersion);
    }
  });

  it("uses each type's context key somewhere in package.json UI gating", () => {
    const raw = fs.readFileSync(path.join(repoRoot, "package.json"), "utf8");
    for (const d of projectTypeRegistry) {
      expect(raw.includes(`dataverse-powertools.${d.contextKey}`), `${d.id}: contextKey ${d.contextKey} unused in package.json`).toBe(true);
    }
  });
});

describe("walkthrough ↔ package.json parity", () => {
  // Context keys the extension sets via setContext; keep in sync with src (a
  // walkthrough step waiting on a key nobody sets would never complete).
  const knownContextKeys = new Set([
    "dataverse-powertools.hasDotnet",
    "dataverse-powertools.hasNode",
    "dataverse-powertools.hasPac",
    "dataverse-powertools.showLoaded",
    "dataverse-powertools.hasSupportedProjectType",
    "dataverse-powertools.folderStateReady",
    "dataverse-powertools.requirementsScanned",
  ]);
  const walkthroughs: { id: string; steps: { id: string; description: string; media?: { markdown?: string }; completionEvents?: string[] }[] }[] =
    packageJson.contributes.walkthroughs;

  it("contributes exactly one walkthrough with steps", () => {
    expect(walkthroughs).toHaveLength(1);
    expect(walkthroughs[0].id).toBe("gettingStarted");
    expect(walkthroughs[0].steps.length).toBeGreaterThanOrEqual(4);
  });

  it("matches the id the panel's Open Walkthrough button targets", () => {
    expect(WALKTHROUGH_ID).toBe(`${packageJson.publisher}.${packageJson.name}#${walkthroughs[0].id}`);
  });

  it("references only declared commands and known context keys from completion events", () => {
    for (const step of walkthroughs[0].steps) {
      for (const event of step.completionEvents ?? []) {
        if (event.startsWith("onCommand:")) {
          expect(contributedIds.has(event.slice("onCommand:".length)), `${step.id}: ${event} not in contributes.commands`).toBe(true);
        } else if (event.startsWith("onContext:")) {
          expect(knownContextKeys.has(event.slice("onContext:".length)), `${step.id}: ${event} uses an unknown context key`).toBe(true);
        } else if (event.startsWith("onView:")) {
          const views = (Object.values(packageJson.contributes.views) as { id: string }[][]).flat().map((v) => v.id);
          expect(views, `${step.id}: ${event} targets an unknown view`).toContain(event.slice("onView:".length));
        }
      }
    }
  });

  it("links only declared commands from step descriptions and ships every media file", () => {
    for (const step of walkthroughs[0].steps) {
      for (const match of step.description.matchAll(/command:(dataverse-powertools\.[A-Za-z]+)/g)) {
        expect(contributedIds.has(match[1]), `${step.id}: description links unknown command ${match[1]}`).toBe(true);
      }
      if (step.media?.markdown) {
        expect(fs.existsSync(path.join(repoRoot, step.media.markdown)), `${step.id}: missing ${step.media.markdown}`).toBe(true);
      }
    }
  });
});
