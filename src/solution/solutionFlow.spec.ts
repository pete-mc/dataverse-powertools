import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./pacRunner", () => ({
  loadSolutionConfig: vi.fn(),
  getEnvironmentUrl: vi.fn(() => "https://org.crm.dynamics.com"),
  runPacSolution: vi.fn(),
  ensurePacAuthForCurrentConnection: vi.fn(),
}));
vi.mock("../components/componentDiscovery", () => ({ activeComponentRoot: vi.fn(() => "C:/ws") }));

import * as vscode from "vscode";
import { loadSolutionConfig, runPacSolution, ensurePacAuthForCurrentConnection } from "./pacRunner";
import { activeComponentRoot } from "../components/componentDiscovery";
import { deploySolutionExec } from "./deploySolution";
import { extractSolutionExec } from "./extractSolution";
import { packSolutionExec } from "./packSolution";
import DataversePowerToolsContext from "../context";
import { SolutionConfig } from "./solutionConfig";

// The solution flows are thin, and that is exactly why they were never tested: each is a short
// sequence of pac calls whose ORDER and SHORT-CIRCUITS are the whole behaviour. Get the order wrong
// and import runs before the auth profile exists; miss a short-circuit and a failed pack is followed
// by an import of a stale zip, reported as success.
//
// pac is stubbed here on purpose. What pac does with the args is `pacArgs.spec.ts`'s job; what
// this asserts is which calls happen, in what order, and what stops the sequence.

const config: SolutionConfig = { uniqueName: "PowerToolsDev", packagePath: "src/PowerToolsDev", zipPath: "bin/PowerToolsDev.zip", packageType: "Both" };

const asMock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const loadConfig = asMock(loadSolutionConfig);
const runPac = asMock(runPacSolution);
const ensureAuth = asMock(ensurePacAuthForCurrentConnection);
const componentRoot = asMock(activeComponentRoot);
const showError = asMock(vscode.window.showErrorMessage);
const showInfo = asMock(vscode.window.showInformationMessage);

/** The order of pac invocations and auth establishment across one run. */
const calls: string[] = [];

function context(): DataversePowerToolsContext {
  return { projectSettings: {}, channel: { appendLine: vi.fn(), show: vi.fn() } } as unknown as DataversePowerToolsContext;
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  componentRoot.mockReturnValue("C:/ws");
  loadConfig.mockResolvedValue(config);
  ensureAuth.mockImplementation(async () => {
    calls.push("auth");
    return true;
  });
  runPac.mockImplementation(async (_ctx: unknown, args: string[]) => {
    calls.push(`pac ${args.slice(0, 2).join(" ")}`);
    return true;
  });
});

describe("deploySolutionExec", () => {
  it("packs, then authenticates, then imports — in that order", async () => {
    await expect(deploySolutionExec(context())).resolves.toBe(true);
    expect(calls).toEqual(["pac solution pack", "auth", "pac solution import"]);
    expect(showInfo).toHaveBeenCalledWith("Solution has been deployed.");
  });

  // A failed pack leaves either no zip or the PREVIOUS one. Importing after it would push stale
  // content to the environment and — since the import itself succeeds — report success.
  it("does not import when the pack failed", async () => {
    runPac.mockImplementationOnce(async () => {
      calls.push("pac solution pack");
      return false;
    });
    await expect(deploySolutionExec(context())).resolves.toBe(false);
    expect(calls).toEqual(["pac solution pack"]);
    expect(showError).toHaveBeenCalled();
  });

  it("does not import when the pac auth profile could not be established", async () => {
    ensureAuth.mockImplementation(async () => {
      calls.push("auth");
      return false;
    });
    await expect(deploySolutionExec(context())).resolves.toBe(false);
    expect(calls).toEqual(["pac solution pack", "auth"]);
  });

  // pac exits 0 on failure (see pacSucceeded / listHasNamedProfile), so runPacSolution's boolean is
  // the only thing standing between a failed import and a success notification.
  it("reports an error — not success — when the import fails", async () => {
    runPac
      .mockImplementationOnce(async () => {
        calls.push("pac solution pack");
        return true;
      })
      .mockImplementationOnce(async () => {
        calls.push("pac solution import");
        return false;
      });
    await expect(deploySolutionExec(context())).resolves.toBe(false);
    expect(showInfo).not.toHaveBeenCalledWith("Solution has been deployed.");
    expect(showError).toHaveBeenCalledWith("Error deploying solution, see output for details.");
  });

  it("stops before any pac call when no solution is configured", async () => {
    loadConfig.mockResolvedValue(undefined);
    await expect(deploySolutionExec(context())).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it("stops when no workspace folder is open", async () => {
    componentRoot.mockReturnValue(undefined);
    await expect(deploySolutionExec(context())).resolves.toBe(false);
    expect(calls).toEqual([]);
    expect(loadConfig).not.toHaveBeenCalled();
  });

  // Multi-component (#47): the pac commands must run in the COMPONENT's folder, not the workspace
  // root, or a solution component in a subfolder packs the wrong tree.
  it("runs pac in the active component's root", async () => {
    componentRoot.mockReturnValue("C:/ws/solution-component");
    await deploySolutionExec(context());
    for (const call of runPac.mock.calls) {
      expect(call[2]).toBe("C:/ws/solution-component");
    }
  });
});

describe("extractSolutionExec", () => {
  // "Both" exports twice — the unmanaged base zip and a managed sibling — because SolutionPackager
  // needs both to produce a combined unpack. Dropping the second export silently degrades the
  // unpacked source to unmanaged-only.
  it("authenticates, exports both zips for a Both config, then unpacks", async () => {
    await expect(extractSolutionExec(context())).resolves.toBe(true);
    expect(calls).toEqual(["auth", "pac solution export", "pac solution export", "pac solution unpack"]);
  });

  it("exports once for a single-package config", async () => {
    loadConfig.mockResolvedValue({ ...config, packageType: "Managed" });
    await expect(extractSolutionExec(context())).resolves.toBe(true);
    expect(calls).toEqual(["auth", "pac solution export", "pac solution unpack"]);
  });

  it("does not unpack when the export failed — that would unpack a stale zip over the source", async () => {
    ensureAuth.mockImplementation(async () => {
      calls.push("auth");
      return true;
    });
    runPac.mockImplementationOnce(async () => {
      calls.push("pac solution export");
      return false;
    });
    await expect(extractSolutionExec(context())).resolves.toBe(false);
    expect(calls).toEqual(["auth", "pac solution export"]);
  });

  it("does not export when the pac auth profile could not be established", async () => {
    ensureAuth.mockImplementation(async () => {
      calls.push("auth");
      return false;
    });
    await expect(extractSolutionExec(context())).resolves.toBe(false);
    expect(calls).toEqual(["auth"]);
  });
});

describe("packSolutionExec", () => {
  // Pack is local — it turns the unpacked source into a zip and touches no environment, so it must
  // not require an auth profile. Making it do so would break packing while offline.
  it("packs locally without establishing pac auth", async () => {
    await expect(packSolutionExec(context())).resolves.toBe(true);
    expect(ensureAuth).not.toHaveBeenCalled();
  });

  // The asymmetry with Deploy is deliberate and easy to "tidy" away: Pack is what a user runs to
  // produce artefacts, so a Both config gets both zips; Deploy packs only the unmanaged zip it is
  // about to import.
  it("produces both zips for a Both config, where deploy packs only the unmanaged one", async () => {
    await packSolutionExec(context());
    expect(calls).toEqual(["pac solution pack", "pac solution pack"]);

    calls.length = 0;
    await deploySolutionExec(context());
    expect(calls.filter((c) => c === "pac solution pack")).toHaveLength(1);
  });

  it("reports failure when pac pack fails", async () => {
    runPac.mockResolvedValue(false);
    await expect(packSolutionExec(context())).resolves.toBe(false);
    expect(showError).toHaveBeenCalled();
  });
});
