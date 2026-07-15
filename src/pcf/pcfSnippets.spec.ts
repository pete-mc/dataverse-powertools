import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// Guards the PCF service-layer snippets (#141) — that the file stays valid JSON,
// keeps the three documented prefixes, and stays registered in package.json so
// the contribution can't silently drift out of sync with the file.

const repoRoot = path.resolve(__dirname, "..", "..");
const snippetsPath = path.join(repoRoot, "snippets", "dvpt-pcf.code-snippets");

function readSnippets(): Record<string, { prefix: string; body: string[]; scope?: string }> {
  return JSON.parse(fs.readFileSync(snippetsPath, "utf8"));
}

describe("PCF service-layer snippets (#141)", () => {
  it("is valid JSON with array bodies", () => {
    const snippets = readSnippets();
    for (const snippet of Object.values(snippets)) {
      expect(Array.isArray(snippet.body)).toBe(true);
      expect(snippet.body.length).toBeGreaterThan(0);
    }
  });

  it("defines the three documented prefixes", () => {
    const prefixes = Object.values(readSnippets()).map((s) => s.prefix);
    expect(prefixes).toEqual(expect.arrayContaining(["dvpt-service", "dvpt-hook", "dvpt-component"]));
  });

  it("scopes the component snippet to typescriptreact (JSX)", () => {
    const component = Object.values(readSnippets()).find((s) => s.prefix === "dvpt-component");
    expect(component?.scope).toContain("typescriptreact");
  });

  it("is registered in package.json for typescript + typescriptreact", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const languages = (pkg.contributes?.snippets ?? []).map((s: { language: string; path: string }) => s.language);
    expect(languages).toEqual(expect.arrayContaining(["typescript", "typescriptreact"]));
    for (const entry of pkg.contributes.snippets) {
      expect(fs.existsSync(path.join(repoRoot, entry.path))).toBe(true);
    }
  });
});
