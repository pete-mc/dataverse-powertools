import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// A guard against the bug class this repo has shipped five times: gating a Dataverse call on `tenantId`
// (#91 typings, #90 register form events, #128/#129 early-bound, #159). Interactive/OAuth sets NO tenant
// — the access token authorises the call — so an `if (tenantId)` style check silently breaks every
// interactive user while working perfectly for whoever wrote it and for every service-principal test.
//
// authParity.spec.ts proves the paths it covers behave the same under both shapes; this catches the
// pattern in the paths nobody remembered to write a parity test for, which is where it got in each time.
// It scans ALL of src deliberately: every one of those bugs was in a FEATURE file (typings, form events,
// early-bound), not in src/general/dataverse. Same idea as previewFeatures.spec.ts checking the registry
// against package.json.

const SRC = path.resolve(__dirname, "..", "..");

/**
 * Files allowed to make decisions on `tenantId`, each because it is service-principal or
 * connection-string plumbing rather than a Dataverse call path:
 *
 *  - dataverseContext / globalDiscovery / pacAuth — a tenant is REQUIRED to swap a client secret for a
 *    token, discover environments with a secret, or create a pac profile from one. Those branches only
 *    run for service principals; interactive takes a different path entirely.
 *  - connectionString / connectionStringManager — parse and build the connection string that CARRIES a
 *    tenant. Reading a field is not gating a call on it.
 */
const ALLOWED = new Set(["dataverseContext.ts", "globalDiscovery.ts", "pacAuth.ts", "connectionString.ts", "connectionStringManager.ts"]);

/**
 * Gate-shaped uses only. Deliberately NOT `tenantId ||` — that is a fallback chain (`tenantId ||
 * parts.tenantId || ""` when passing one INTO service-principal discovery), which is a default, not a
 * gate, and flagging it produced only false positives.
 */
const GATE_PATTERNS = [
  /if\s*\([^)]*tenantId[^)]*\)/, //            if (…tenantId…)
  /!\s*[\w.?]*tenantId\b/, //                  !tenantId  /  !settings.tenantId
  /\btenantId\s*\?(?!:)/, //                   tenantId ? … : …   (not the `tenantId?:` of a type)
  /\btenantId\s*[=!]==?\s*(undefined|null|"")/, // tenantId === undefined | null | ""
];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // ui-test drives the product from outside; its helpers may legitimately assemble credentials.
      if (entry.name !== "ui-test") {
        sourceFiles(full, found);
      }
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts")) {
      found.push(full);
    }
  }
  return found;
}

/** Source with comments stripped — a comment saying "never gate on tenantId" must not trip the guard. */
function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("no Dataverse path gates on tenantId", () => {
  const files = sourceFiles(SRC);
  const offenders: string[] = [];
  for (const file of files) {
    if (ALLOWED.has(path.basename(file))) {
      continue;
    }
    const code = codeWithoutComments(fs.readFileSync(file, "utf8"));
    for (const pattern of GATE_PATTERNS) {
      const hit = pattern.exec(code);
      if (hit) {
        offenders.push(`${path.relative(SRC, file).replace(/\\/g, "/")}: ${hit[0].trim()}`);
        break;
      }
    }
  }

  it("finds no tenantId gate anywhere in src", () => {
    expect(
      offenders,
      "Gate on the live connection instead — canCallDataverseApi({ organizationUrl, isValid }).\n" +
        "Interactive auth has no tenant, so these break OAuth users while passing every service-principal test:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("actually scanned the codebase, so a pass means what it says", () => {
    expect(files.length, "source files scanned").toBeGreaterThan(100);
  });

  it("still catches the shapes it exists to catch", () => {
    // Without this, a regex that stopped matching would make the suite pass vacuously.
    for (const sample of [
      "if (!context.projectSettings.tenantId) { return; }",
      "if (settings.tenantId && url) { call(); }",
      "return tenantId ? call() : undefined;",
      "if (settings.tenantId === undefined) { return false; }",
      "const ok = !dataverse.tenantId;",
    ]) {
      expect(
        GATE_PATTERNS.some((pattern) => pattern.test(sample)),
        `should flag: ${sample}`,
      ).toBe(true);
    }
  });

  it("does not flag a type declaration or a fallback chain", () => {
    // The two shapes that made the first version of this guard cry wolf.
    for (const sample of ["  tenantId?: string;", 'discoverEnvironmentsWithSecret(id, secret, settings.tenantId || parts.tenantId || "");']) {
      expect(
        GATE_PATTERNS.some((pattern) => pattern.test(sample)),
        `should NOT flag: ${sample}`,
      ).toBe(false);
    }
  });
});
