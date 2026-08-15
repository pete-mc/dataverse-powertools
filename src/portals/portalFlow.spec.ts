import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../general/pacAuth", () => ({
  ensurePacAuthForCurrentConnection: vi.fn(),
  runPacLoggedHealing: vi.fn(),
  runPacResult: vi.fn(),
}));
vi.mock("../components/componentDiscovery", () => ({ activeComponentRoot: vi.fn(() => "C:/ws") }));

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ensurePacAuthForCurrentConnection, runPacLoggedHealing, runPacResult } from "../general/pacAuth";
import { activeComponentRoot } from "../components/componentDiscovery";
import { connectPortal, downloadPortal } from "./connectPortal";
import DataversePowerToolsContext from "../context";

// The Power Pages round-trip (#74) had pure coverage for its arg builders and list parsing, but
// nothing for the flow that strings them together — and the flow is where the interesting failures
// are: uploading before anything was downloaded, downloading without an auth profile, and the
// upload path resolution, which has to find the folder pac actually wrote (`pac pages download`
// nests the site one level below the target path, but not always).

const asMock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const ensureAuth = asMock(ensurePacAuthForCurrentConnection);
const runHealing = asMock(runPacLoggedHealing);
const runResult = asMock(runPacResult);
const componentRoot = asMock(activeComponentRoot);
const showError = asMock(vscode.window.showErrorMessage);
const showInfo = asMock(vscode.window.showInformationMessage);
const showQuickPick = asMock(vscode.window.showQuickPick);

const SITE_LIST = ["Website Name        Website Id", "Contoso Portal      11111111-1111-1111-1111-111111111111"].join("\n");

let workspace: string;

function context(settings: Record<string, unknown> = {}): DataversePowerToolsContext {
  return {
    projectSettings: settings,
    channel: { appendLine: vi.fn(), show: vi.fn() },
    writeSettings: vi.fn(),
    refreshPanel: vi.fn(),
  } as unknown as DataversePowerToolsContext;
}

/** The pac subcommand of each invocation, in order. */
function pacCalls(): string[] {
  return [...runResult.mock.calls, ...runHealing.mock.calls].map((call) => (Array.isArray(call[0]) ? call[0] : call[1]) as string[]).map((args) => args.slice(0, 2).join(" "));
}

beforeEach(() => {
  vi.clearAllMocks();
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dvpt-portal-"));
  componentRoot.mockReturnValue(workspace);
  ensureAuth.mockResolvedValue(true);
  runHealing.mockResolvedValue(true);
  runResult.mockResolvedValue({ code: 0, stdout: SITE_LIST, stderr: "" });
  showQuickPick.mockResolvedValue(undefined);
});

afterEach(() => fs.rmSync(workspace, { recursive: true, force: true }));

describe("connect", () => {
  it("establishes the pac auth profile before listing sites", async () => {
    const order: string[] = [];
    ensureAuth.mockImplementation(async () => {
      order.push("auth");
      return true;
    });
    runResult.mockImplementation(async () => {
      order.push("list");
      return { code: 0, stdout: SITE_LIST, stderr: "" };
    });
    await connectPortal(context(), "connect");
    expect(order).toEqual(["auth", "list"]);
  });

  it("does nothing when the pac auth profile could not be established", async () => {
    ensureAuth.mockResolvedValue(false);
    await connectPortal(context(), "connect");
    expect(runResult).not.toHaveBeenCalled();
    expect(runHealing).not.toHaveBeenCalled();
  });

  it("remembers the chosen site so download and upload need no second pick", async () => {
    const settings: Record<string, unknown> = {};
    const ctx = context(settings);
    showQuickPick.mockResolvedValue({ target: { websiteId: "site-1", friendlyName: "Contoso Portal" } });
    await connectPortal(ctx, "connect");
    expect(settings.portalWebsiteId).toBe("site-1");
    expect(settings.portalWebsiteName).toBe("Contoso Portal");
    expect(ctx.writeSettings).toHaveBeenCalled();
  });

  it("reports a failed list rather than proceeding with no sites", async () => {
    runResult.mockResolvedValue({ code: 1, stdout: "", stderr: "not authenticated" });
    await connectPortal(context(), "connect");
    expect(showError).toHaveBeenCalled();
    expect(showInfo).not.toHaveBeenCalled();
  });

  it("says so when the environment has no Power Pages sites", async () => {
    runResult.mockResolvedValue({ code: 0, stdout: "Website Name        Website Id", stderr: "" });
    await connectPortal(context(), "connect");
    expect(showError).toHaveBeenCalledWith("No Power Pages websites were found in this environment.");
  });
});

describe("download", () => {
  it("downloads the remembered site without prompting", async () => {
    await connectPortal(context({ portalWebsiteId: "site-1" }), "download");
    expect(showQuickPick).not.toHaveBeenCalled();
    expect(pacCalls()).toEqual(["pages download"]);
  });

  it("picks a site first when none is remembered", async () => {
    showQuickPick.mockResolvedValue({ target: { websiteId: "site-9", friendlyName: "Fresh" } });
    await connectPortal(context(), "download");
    expect(pacCalls()).toEqual(["pages list", "pages download"]);
  });

  it("does not download when the site pick was dismissed", async () => {
    await connectPortal(context(), "download");
    expect(runHealing).not.toHaveBeenCalled();
  });

  it("surfaces a failed download instead of claiming success", async () => {
    runHealing.mockResolvedValue(false);
    await connectPortal(context({ portalWebsiteId: "site-1" }), "download");
    expect(showError).toHaveBeenCalledWith("pac pages download failed. See the Dataverse PowerTools output.");
  });

  it("downloadPortal is the download mode", async () => {
    await downloadPortal(context({ portalWebsiteId: "site-1" }));
    expect(pacCalls()).toEqual(["pages download"]);
  });
});

describe("upload path resolution", () => {
  // `pac pages upload` wants the folder that CONTAINS website.yml. Where that is depends on how the
  // site got there: pac's own download nests it one level down, while a site committed to the repo
  // usually sits directly in the configured folder. Both have to work, and neither may be guessed —
  // uploading the wrong folder is a live change to a website.
  it("uploads the configured folder when website.yml is directly in it", async () => {
    const root = path.join(workspace, "portalpublish");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "website.yml"), "name: site", "utf8");

    await connectPortal(context(), "upload");
    expect(runHealing.mock.calls[0][1]).toContain(root);
  });

  it("descends into the single site subfolder pac's download created", async () => {
    const nested = path.join(workspace, "portalpublish", "contoso-portal");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "website.yml"), "name: site", "utf8");

    await connectPortal(context(), "upload");
    expect(runHealing.mock.calls[0][1]).toContain(nested);
  });

  it("honours a configured download path", async () => {
    const nested = path.join(workspace, "sites", "contoso");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "website.yml"), "name: site", "utf8");

    await connectPortal(context({ portalDownloadPath: "sites" }), "upload");
    expect(runHealing.mock.calls[0][1]).toContain(nested);
  });

  it("refuses to upload when nothing has been downloaded", async () => {
    await connectPortal(context(), "upload");
    expect(runHealing).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalled();
  });

  it("refuses to upload a folder tree with no website.yml anywhere", async () => {
    fs.mkdirSync(path.join(workspace, "portalpublish", "not-a-site"), { recursive: true });
    await connectPortal(context(), "upload");
    expect(runHealing).not.toHaveBeenCalled();
  });

  it("surfaces a failed upload instead of claiming success", async () => {
    const root = path.join(workspace, "portalpublish");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "website.yml"), "name: site", "utf8");
    runHealing.mockResolvedValue(false);

    await connectPortal(context(), "upload");
    expect(showError).toHaveBeenCalledWith("pac pages upload failed. See the Dataverse PowerTools output.");
    expect(showInfo).not.toHaveBeenCalledWith("Power Pages site uploaded.");
  });
});
