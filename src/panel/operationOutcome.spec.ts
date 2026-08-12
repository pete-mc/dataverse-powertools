import { describe, it, expect } from "vitest";
import { classifyOperationOutput, FAILURE_MARKER, WARNING_MARKER } from "./operationOutcome";

// #229: the feed rendered every command that RESOLVED as ✓, including a deploy whose build died,
// because commands report failures to the output channel and return normally. These cases are the real
// lines the real commands write — the signal table is only worth having if it matches them, and only
// safe if it leaves ordinary success alone.

describe("classifyOperationOutput", () => {
  it("calls a clean run a success", () => {
    expect(classifyOperationOutput(["Building...", "webpack 5.109.2 compiled successfully in 5744 ms", "Building Complete", "Publish Complete"])).toEqual({ status: "success" });
    expect(classifyOperationOutput([])).toEqual({ status: "success" });
  });

  it("catches the canonical marker a command writes when it handles its own failure", () => {
    expect(classifyOperationOutput(["Building...", `${FAILURE_MARKER} Build failed: Command failed: npx webpack --config webpack.dev.js`])).toEqual({
      status: "error",
      detail: "Build failed: Command failed: npx webpack --config webpack.dev.js",
    });
  });

  it("catches the legacy failure lines commands already log", () => {
    // Each of these is a real line from a real path, and each one used to render as ✓.
    expect(classifyOperationOutput(["Build failed: Command failed: npx webpack --config webpack.dev.js"]).status).toBe("error");
    expect(classifyOperationOutput(["Build failed; deployment skipped."]).status).toBe("error");
    expect(classifyOperationOutput(["Azure Function build failed: MSB1009"]).status).toBe("error");
    expect(classifyOperationOutput(["Could not connect to dataverse."]).status).toBe("error");
    expect(classifyOperationOutput(["Failed to publish customizations: 500 boom"]).status).toBe("error");
    expect(classifyOperationOutput(["Error building webresources"]).status).toBe("error");
    expect(classifyOperationOutput(["✗ dvpt_DoThing: 2 validation error(s) — fix before deploy."]).status).toBe("error");
  });

  it("reports a partial success as a warning, not a failure and not a clean ✓", () => {
    expect(classifyOperationOutput(["Deploying...", "Could not associate step 'Create account' with solution 'Dev'."])).toEqual({
      status: "warning",
      detail: "Could not associate step 'Create account' with solution 'Dev'.",
    });
    expect(classifyOperationOutput([`${WARNING_MARKER} 1 step skipped`])).toEqual({ status: "warning", detail: "1 step skipped" });
    expect(classifyOperationOutput(["Warning: skipped 2 malformed RegisterEvent decoration block(s)."]).status).toBe("warning");
    expect(classifyOperationOutput(["[Add Component] Post-add onboarding failed (non-fatal): ENOENT"]).status).toBe("warning");
    expect(classifyOperationOutput(["Unable to resolve webresource id for dvpt_library.js; skipping solution association."]).status).toBe("warning");
  });

  it("lets a failure win over a warning — a command that failed and also warned has failed", () => {
    expect(classifyOperationOutput(["Warning: skipped 1 malformed RegisterEvent decoration block(s).", "Build failed; deployment skipped."]).status).toBe("error");
  });

  it("reports the FIRST failure, which is the one that caused the rest", () => {
    expect(classifyOperationOutput(["Build failed: first cause", "Error building webresources"]).detail).toBe("Build failed: first cause");
  });

  it("does not mistake ordinary output for a failure", () => {
    // A false ✗ on a successful operation is its own lie, so the table has to stay narrow.
    const benign = [
      "0 errors",
      "Build succeeded.",
      "No form event registrations found; nothing to register.",
      "Deploying 3 web resources...",
      "assets by status 1.2 MiB [cached] 1 asset",
      "Publishing all customizations...",
      "Publish Complete",
      "[Components] 2 components discovered",
      "Errors: 0",
      "Tests failed: 0",
    ];
    expect(classifyOperationOutput(benign)).toEqual({ status: "success" });
  });

  it("handles the multi-line blocks appendLine is called with, once split", () => {
    const buildOutput = ["ERROR in ./src/index.ts", "TS2304: Cannot find name 'foo'.", "Build failed: webpack reported errors in the bundle."];
    expect(classifyOperationOutput(buildOutput).status).toBe("error");
  });
});
