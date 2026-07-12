// Downloads the bundled Windows-only (net48) plugin-profiler capture tool into
// tools/pluginprofiler/ so it is packaged into the VSIX. The tool is built by a
// Windows CI job (.github/workflows/build-profiler-tool.yml) and published as a
// release artifact rather than committed, to keep this repo lean — the same shape
// as scripts/fetchTypingsTool.mjs.
//
//   node scripts/fetchProfilerTool.mjs        (set DVPT_FORCE_TOOL_FETCH=1 to re-download)
//
// Windows-only feature: the tool drives Start/Stop Profiling headlessly. On macOS/Linux
// the extension never runs it (users take the manual download-a-profile path), so a
// missing tool is not fatal for building/testing — only for a complete VSIX.
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");

// Pinned tool release. Bump this (and re-run) when the tool is rebuilt.
const TOOL_URL = "https://github.com/pete-mc/dataverse-powertools/releases/download/profiler-tool-v1.0.0/dvpt-pluginprofiler-net48.zip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "tools", "pluginprofiler");
const marker = path.join(dest, "DvptPluginProfiler.exe");

// On `postinstall` a download blip must not hard-fail `npm install`. When invoked
// explicitly via `npm run fetch-profiler-tool` (which `vscode:prepublish` does), a
// failure IS fatal so a VSIX is never packaged without the tool. We set
// `process.exitCode` and return rather than calling `process.exit()` mid-fetch — the
// latter can trip a libuv assertion on Windows while the socket is still closing.
const lenient = process.env.npm_lifecycle_event === "postinstall";

function fail(msg) {
  console.error(`[fetch-profiler-tool] ${msg}`);
  process.exitCode = lenient ? 0 : 1;
}

async function main() {
  if (fs.existsSync(marker) && !process.env.DVPT_FORCE_TOOL_FETCH) {
    console.log("[fetch-profiler-tool] tool already present — skipping download");
    return;
  }

  console.log("[fetch-profiler-tool] downloading", TOOL_URL);
  let res;
  try {
    res = await fetch(TOOL_URL);
  } catch (e) {
    return fail(`download error: ${e?.message ?? e}${lenient ? " — skipping (run `npm run fetch-profiler-tool` before packaging)" : ""}`);
  }
  if (!res.ok) {
    return fail(`download failed: ${res.status} ${res.statusText}${lenient ? " — skipping (run `npm run fetch-profiler-tool` before packaging)" : ""}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  new AdmZip(buf).extractAllTo(dest, true);

  if (!fs.existsSync(marker)) {
    console.error("[fetch-profiler-tool] extraction did not produce DvptPluginProfiler.exe");
    process.exitCode = 1;
    return;
  }
  console.log("[fetch-profiler-tool] extracted to", dest);
}

await main();
