// Downloads the bundled cross-platform (net8) XrmDefinitelyTyped typings tool into
// tools/xrmdefinitelytyped/ so it is packaged into the VSIX. The tool is published as a release
// artifact on the fork (pete-mc/XrmDefinitelyTyped) rather than committed, to keep this repo lean.
// Runs on postinstall and before packaging (vscode:prepublish); skips if already present.
//
//   node scripts/fetchTypingsTool.mjs        (set DVPT_FORCE_TOOL_FETCH=1 to re-download)
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const AdmZip = require("adm-zip");

// Pinned tool release. Bump this (and re-run) when the tool is rebuilt.
const TOOL_URL = "https://github.com/pete-mc/XrmDefinitelyTyped/releases/download/typings-tool-v1.0.0/xrmdefinitelytyped-net8.zip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(root, "tools", "xrmdefinitelytyped");
const marker = path.join(dest, "XrmDefinitelyTyped.dll");

if (fs.existsSync(marker) && !process.env.DVPT_FORCE_TOOL_FETCH) {
  console.log("[fetch-typings-tool] tool already present — skipping download");
  process.exit(0);
}

console.log("[fetch-typings-tool] downloading", TOOL_URL);
const res = await fetch(TOOL_URL);
if (!res.ok) {
  console.error(`[fetch-typings-tool] download failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
new AdmZip(buf).extractAllTo(dest, true);

if (!fs.existsSync(marker)) {
  console.error("[fetch-typings-tool] extraction did not produce XrmDefinitelyTyped.dll");
  process.exit(1);
}
console.log("[fetch-typings-tool] extracted to", dest);
