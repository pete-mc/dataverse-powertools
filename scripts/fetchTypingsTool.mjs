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

// On `postinstall` a download blip must not hard-fail `npm install` (CI/contributors only need the
// tool for typings generation + packaging, not for building/testing). When invoked explicitly via
// `npm run fetch-typings-tool` (which `vscode:prepublish` does), a failure IS fatal so a VSIX is
// never packaged without the tool.
const lenient = process.env.npm_lifecycle_event === "postinstall";
const fail = (msg) => {
  console.error(`[fetch-typings-tool] ${msg}`);
  process.exit(lenient ? 0 : 1);
};

if (fs.existsSync(marker) && !process.env.DVPT_FORCE_TOOL_FETCH) {
  console.log("[fetch-typings-tool] tool already present — skipping download");
  process.exit(0);
}

console.log("[fetch-typings-tool] downloading", TOOL_URL);
let res;
try {
  res = await fetch(TOOL_URL);
} catch (e) {
  fail(`download error: ${e?.message ?? e}${lenient ? " — skipping (run `npm run fetch-typings-tool` before packaging)" : ""}`);
}
if (!res.ok) {
  fail(`download failed: ${res.status} ${res.statusText}`);
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
