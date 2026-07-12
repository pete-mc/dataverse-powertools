import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import { LiveEnv } from "../liveEnv";

// Live-test helper (#63): make sure the Plugin Profiler managed solution is
// installed in the sandbox org. The solution ships inside the Plugin
// Registration Tool NuGet as PluginProfiler.Solution.cab (which is actually a
// ZIP); we download the nupkg once into a gitignored cache, extract the
// solution, and ImportSolution it. Idempotent — an installed profiler short-
// circuits. Phase 2c reuses the same cached nupkg for PluginProfiler.Library.dll.

const PRT_NUPKG_URL = "https://www.nuget.org/api/v2/package/Microsoft.CrmSdk.XrmTooling.PluginRegistrationTool";
const CACHE_DIR = path.resolve(__dirname, "..", "..", "sandbox", ".cache", "pluginprofiler");

export async function acquireToken(env: LiveEnv): Promise<string> {
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", env.clientId);
  params.append("client_secret", env.clientSecret);
  params.append("resource", env.url);
  const response = await fetch(`https://login.microsoftonline.com/${env.tenantId}/oauth2/token`, { method: "POST", body: params });
  const data: any = await response.json();
  if (!data?.access_token) {
    throw new Error(`Token request failed: ${data?.error_description ?? "unknown"}`);
  }
  return data.access_token;
}

export async function webApi(env: LiveEnv, token: string, method: string, resourcePath: string, body?: unknown): Promise<{ status: number; body: any }> {
  /* eslint-disable @typescript-eslint/naming-convention */
  const response = await fetch(`${env.url.replace(/\/+$/, "")}/api/data/v9.2/${resourcePath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  /* eslint-enable @typescript-eslint/naming-convention */
  const text = await response.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

/** Download + cache the PRT nupkg, returning the path to the profiler solution ZIP. */
export async function fetchProfilerSolutionZip(): Promise<string> {
  const solutionZip = path.join(CACHE_DIR, "PluginProfiler.Solution.zip");
  if (fs.existsSync(solutionZip)) {
    return solutionZip;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const nupkg = path.join(CACHE_DIR, "prt.nupkg");
  if (!fs.existsSync(nupkg)) {
    const response = await fetch(PRT_NUPKG_URL);
    if (!response.ok) {
      throw new Error(`PRT nupkg download failed: ${response.status}`);
    }
    fs.writeFileSync(nupkg, Buffer.from(await response.arrayBuffer()));
  }
  // The nupkg is a zip; the "cab" inside tools/ is ALSO a zip (the solution).
  // PowerShell on the Windows VM; unzip elsewhere.
  const extractDir = path.join(CACHE_DIR, "nupkg");
  extractZip(nupkg, extractDir);
  const cab = path.join(extractDir, "tools", "PluginProfiler.Solution.cab");
  if (!fs.existsSync(cab)) {
    throw new Error(`PluginProfiler.Solution.cab not found in the PRT nupkg (${extractDir})`);
  }
  fs.copyFileSync(cab, solutionZip);
  return solutionZip;
}

function extractZip(zipFile: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  if (process.platform === "win32") {
    // Expand-Archive requires a .zip extension — stage a copy when needed.
    const staged = zipFile.endsWith(".zip") ? zipFile : `${zipFile}.zip`;
    if (staged !== zipFile) {
      fs.copyFileSync(zipFile, staged);
    }
    const result = cp.spawnSync("powershell.exe", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${staged}' -DestinationPath '${destination}' -Force`], {
      encoding: "utf8",
      timeout: 120000,
    });
    if (result.status !== 0) {
      throw new Error(`Expand-Archive failed: ${result.stderr}`);
    }
  } else {
    const result = cp.spawnSync("unzip", ["-o", "-q", zipFile, "-d", destination], { encoding: "utf8", timeout: 120000 });
    if (result.status !== 0) {
      throw new Error(`unzip failed: ${result.stderr}`);
    }
  }
}

/** Install the profiler solution when absent. Returns "already" | "installed". */
export async function ensureProfilerInstalled(env: LiveEnv, token: string): Promise<"already" | "installed"> {
  const check = await webApi(env, token, "GET", "solutions?$select=solutionid&$filter=uniquename eq 'PluginProfiler'");
  if (check.status === 200 && (check.body.value?.length ?? 0) > 0) {
    return "already";
  }
  const zip = await fetchProfilerSolutionZip();
  const customizationFile = fs.readFileSync(zip).toString("base64");
  /* eslint-disable @typescript-eslint/naming-convention */
  const importResult = await webApi(env, token, "POST", "ImportSolution", {
    OverwriteUnmanagedCustomizations: false,
    PublishWorkflows: false,
    CustomizationFile: customizationFile,
    ImportJobId: cryptoRandomGuid(),
  });
  /* eslint-enable @typescript-eslint/naming-convention */
  if (importResult.status !== 204) {
    throw new Error(`ImportSolution failed (${importResult.status}): ${JSON.stringify(importResult.body).slice(0, 400)}`);
  }
  return "installed";
}

function cryptoRandomGuid(): string {
  const bytes = require("crypto").randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
