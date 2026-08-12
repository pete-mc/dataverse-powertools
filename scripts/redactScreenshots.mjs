// Redact the test environment's identity from documentation screenshots.
//
// Usage: node scripts/redactScreenshots.mjs <directory-of-pngs>
//
// The e2e screenshot frames (DVPT_E2E_SHOTS=1) show the panel's connection block and the status bar,
// both of which carry the sandbox org URL. Those frames go on the PUBLIC wiki, and a wiki push is
// one-way — so paint over the two regions rather than relying on nobody reading them. Keep the raw
// frames if you need to check what was covered; this rewrites in place.
//
// Regions are measured against the 1718x872 window the e2e instance uses. If that size changes, the
// script reports frames it could not fully cover instead of silently redacting the wrong pixels.
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";

const EXPECTED = { width: 1718, height: 872 };
const REGIONS = [
  { x: 68, y: 86, w: 268, h: 56, label: "panel connection block (org name + url + auth type)" },
  { x: 36, y: 851, w: 268, h: 20, label: "status bar org url" },
];
const FILL = { r: 37, g: 37, b: 38 }; // VS Code dark sidebar / status-bar background

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: node scripts/redactScreenshots.mjs <directory-of-pngs>");
  process.exit(2);
}

let redacted = 0;
const skipped = [];
for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith(".png"))) {
  const file = path.join(dir, name);
  const png = PNG.sync.read(fs.readFileSync(file));
  if (png.width !== EXPECTED.width || png.height !== EXPECTED.height) {
    skipped.push(`${name} (${png.width}x${png.height}, expected ${EXPECTED.width}x${EXPECTED.height})`);
    continue;
  }
  for (const region of REGIONS) {
    for (let y = region.y; y < region.y + region.h; y++) {
      for (let x = region.x; x < region.x + region.w; x++) {
        const offset = (png.width * y + x) << 2;
        png.data[offset] = FILL.r;
        png.data[offset + 1] = FILL.g;
        png.data[offset + 2] = FILL.b;
        png.data[offset + 3] = 255;
      }
    }
  }
  fs.writeFileSync(file, PNG.sync.write(png));
  redacted++;
}

console.log(`redacted ${redacted} frame(s) in ${dir}`);
if (skipped.length > 0) {
  console.warn(`NOT redacted (unexpected size — check the regions before publishing):\n  ${skipped.join("\n  ")}`);
  process.exit(1);
}
