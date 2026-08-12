// Redact the test environment's identity from documentation screenshots.
//
// Usage: node scripts/redactScreenshots.mjs <directory-of-pngs>
//
// The e2e screenshot frames (DVPT_E2E_SHOTS=1) show the sandbox org URL in the panel's connection
// block, in the status bar, and in the query results header. Those frames go on the PUBLIC wiki and a
// wiki push is one-way, so paint over those regions rather than relying on nobody reading them.
//
// Regions are measured against the 1718x872 window the e2e instance uses. If that size changes, the
// script reports frames it could not fully cover instead of silently redacting the wrong pixels.
//
// TWO WAYS TO GET THIS WRONG, both of which have happened:
//
//  * under-redact — a frame keeps the org URL. Guarded by the status-bar region applying to EVERY frame
//    (the status bar is always there) and by the per-frame report printed at the end.
//  * OVER-redact — a region lands on content the frame exists to show. The sidebar is not always the
//    PowerTools panel: in a debug frame it is Run and Debug, and the connection-block rectangle covers
//    the Locals list, which blanked the one frame whose whole point was the captured values. So the
//    sidebar region is opt-IN via `match`, not applied blindly.
//
// Originals are copied to <dir>/raw/ before anything is painted, so a wrong region costs a copy rather
// than another 7-minute e2e run.
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";

const EXPECTED = { width: 1718, height: 872 };

/**
 * Frames whose sidebar is the PowerTools panel, so the connection block is really there.
 *
 * Anything captured by `clickPanelButton`'s `shot` option qualifies (the panel has to be open to click
 * a button in it), as do the deliberate panel shots. Frames taken with the Run and Debug view, the
 * Explorer or the Testing view showing are NOT in here — see the over-redaction note above.
 */
const PANEL_FRAMES = /^(00-|01-profile-next-run|02-trigger|03-|04-|05-generate-replay-test|08-replay-and-debug|panel-|menu-)/;
const REGIONS = [
  // The status bar carries the org URL in every frame, whatever the sidebar is showing.
  { x: 36, y: 851, w: 268, h: 20, label: "status bar org url" },
  // The panel's connection block — ONLY on frames where the sidebar actually shows the panel. On a
  // debug frame these pixels are the Locals list.
  { x: 68, y: 86, w: 268, h: 56, label: "panel connection block (org name + url + auth type)", match: PANEL_FRAMES },
  // The query results view states the org and the identity the query ran as ("Ran against <url> as
  // <user>") — deliberate in the product, but it is the org URL again. Only the FetchXML frames have
  // that panel. The fill is SAMPLED from just left of the region so it matches whatever background is
  // there rather than leaving a sidebar-coloured block mid-editor.
  { x: 1063, y: 95, w: 520, h: 18, label: "query results 'Ran against <org> as <user>'", match: /^fetchxml-/, sample: true },
];
const FILL = { r: 37, g: 37, b: 38 }; // VS Code dark sidebar / status-bar background

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: node scripts/redactScreenshots.mjs <directory-of-pngs>");
  process.exit(2);
}

let redacted = 0;
const skipped = [];
const report = [];
// Originals live here untouched, so re-running with a corrected region list never needs another e2e run.
const rawDir = path.join(dir, "raw");
fs.mkdirSync(rawDir, { recursive: true });
for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith(".png"))) {
  const file = path.join(dir, name);
  const raw = path.join(rawDir, name);
  // Redact from the ORIGINAL every time: painting over an already-painted frame would compound a bad
  // region, and re-running after a fix would have nothing clean to work from.
  //
  // A FRESH capture must win over the stored original, or a re-shoot would be silently overwritten by
  // the previous run's copy — so compare mtimes rather than assuming raw/ is always authoritative.
  const rawIsCurrent = fs.existsSync(raw) && fs.statSync(raw).mtimeMs >= fs.statSync(file).mtimeMs;
  if (rawIsCurrent) {
    fs.copyFileSync(raw, file);
  } else {
    fs.copyFileSync(file, raw);
  }
  const png = PNG.sync.read(fs.readFileSync(file));
  if (png.width !== EXPECTED.width || png.height !== EXPECTED.height) {
    skipped.push(`${name} (${png.width}x${png.height}, expected ${EXPECTED.width}x${EXPECTED.height})`);
    continue;
  }
  const applied = [];
  for (const region of REGIONS) {
    if (region.match && !region.match.test(name)) {
      continue;
    }
    applied.push(region.label);
    let fill = FILL;
    if (region.sample) {
      // Take the colour from just left of the region, so the patch matches whatever panel it lands on
      // instead of leaving a sidebar-coloured block in the middle of an editor.
      const sampleOffset = (png.width * (region.y + (region.h >> 1)) + Math.max(0, region.x - 4)) << 2;
      fill = { r: png.data[sampleOffset], g: png.data[sampleOffset + 1], b: png.data[sampleOffset + 2] };
    }
    for (let y = region.y; y < region.y + region.h; y++) {
      for (let x = region.x; x < region.x + region.w; x++) {
        const offset = (png.width * y + x) << 2;
        png.data[offset] = fill.r;
        png.data[offset + 1] = fill.g;
        png.data[offset + 2] = fill.b;
        png.data[offset + 3] = 255;
      }
    }
  }
  fs.writeFileSync(file, PNG.sync.write(png));
  report.push(`  ${name}: ${applied.join(", ")}`);
  redacted++;
}

// Print what was painted per frame. Under-redaction is caught by reading this; over-redaction is caught
// by looking at the frame — which is the point of keeping raw/.
console.log(`redacted ${redacted} frame(s) in ${dir} (originals kept in ${path.relative(process.cwd(), rawDir)})`);
console.log(report.join("\n"));
if (skipped.length > 0) {
  console.warn(`NOT redacted (unexpected size — check the regions before publishing):\n  ${skipped.join("\n  ")}`);
  process.exit(1);
}
