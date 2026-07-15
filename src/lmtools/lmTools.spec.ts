import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { LM_TOOLS, isToolAllowed, readOnlyRefusal, formatConnectionSummary, formatComponentList, formatRequirements } from "./lmTools";

describe("LM_TOOLS ↔ package.json parity (#140)", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8"));
  const contributed: { name: string }[] = pkg.contributes.languageModelTools ?? [];

  it("registers exactly the contributed tools (names match both ways)", () => {
    const specNames = LM_TOOLS.map((t) => t.name).sort();
    const contributedNames = contributed.map((t) => t.name).sort();
    expect(specNames).toEqual(contributedNames);
  });

  it("uses the readwrite access-mode setting declared in package.json", () => {
    expect(pkg.contributes.configuration.properties["dataverse-powertools.copilot.accessMode"]).toBeTruthy();
  });
});

describe("LM_TOOLS", () => {
  it("has unique tool names", () => {
    const names = LM_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every mutating tool a command + confirm title", () => {
    for (const t of LM_TOOLS.filter((x) => x.mutating)) {
      expect(t.command, `${t.name} needs a command`).toBeTruthy();
      expect(t.confirmTitle, `${t.name} needs a confirm title`).toBeTruthy();
    }
  });
});

describe("isToolAllowed", () => {
  const read = { name: "r", mutating: false };
  const write = { name: "w", mutating: true, command: "c", confirmTitle: "t" };

  it("always allows read tools", () => {
    expect(isToolAllowed(read, "readonly")).toBe(true);
    expect(isToolAllowed(read, "readwrite")).toBe(true);
  });

  it("only allows mutating tools in readwrite mode", () => {
    expect(isToolAllowed(write, "readonly")).toBe(false);
    expect(isToolAllowed(write, "readwrite")).toBe(true);
  });
});

describe("readOnlyRefusal", () => {
  it("names the tool and the setting to change", () => {
    const msg = readOnlyRefusal("dvpt_deploy");
    expect(msg).toContain("dvpt_deploy");
    expect(msg).toContain("dataverse-powertools.copilot.accessMode");
    expect(msg).toContain("readwrite");
  });
});

describe("formatConnectionSummary", () => {
  it("reports no project when nothing is loaded", () => {
    expect(formatConnectionSummary({ loaded: false, connected: false })).toContain("No Dataverse PowerTools project");
  });

  it("summarizes org, auth type and status without secrets", () => {
    const out = formatConnectionSummary({ loaded: true, organizationUrl: "https://org.crm.dynamics.com", authType: "oauth", connected: true });
    expect(out).toContain("https://org.crm.dynamics.com");
    expect(out).toContain("interactive (OAuth)");
    expect(out).toContain("connected");
    expect(out.toLowerCase()).not.toContain("secret");
    expect(out.toLowerCase()).not.toContain("token");
  });

  it("labels service-principal auth", () => {
    expect(formatConnectionSummary({ loaded: true, authType: "clientsecret", connected: false })).toContain("service principal");
  });
});

describe("formatComponentList", () => {
  it("handles an empty workspace", () => {
    expect(formatComponentList([])).toContain("No components");
  });

  it("marks the root and lists subfolders", () => {
    const out = formatComponentList([
      { type: "plugin", name: "MyPlugin", relativeRoot: "", isRoot: true },
      { type: "webresource", name: "Web", relativeRoot: "web", isRoot: false },
    ]);
    expect(out).toContain("plugin: MyPlugin (root)");
    expect(out).toContain("webresource: Web (web)");
  });
});

describe("formatRequirements", () => {
  it("flags missing requirements", () => {
    const out = formatRequirements([
      { name: "dotnet", installed: true },
      { name: "pac", installed: false },
    ]);
    expect(out).toContain("dotnet: installed");
    expect(out).toContain("pac: MISSING");
  });
});
