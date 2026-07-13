// Regenerates the extension logo assets from the single source of truth below:
//   media/logo_new.png  — full-colour Marketplace icon + README hero (512x512, transparent)
//   media/logo_new.svg  — activity-bar / command icon (rounded gradient hex with the bolt
//                          cut out, so VS Code's monochrome tinting shows the bolt)
//
// The mark: a blue->violet rounded hexagon (Power Platform) with a lightning bolt
// (PowerTools). These are committed static assets — you only need to run this to change
// the logo. It uses @resvg/resvg-js, which is NOT a project dependency (keeps the repo
// lean): install it first, then run.
//
//   npm i -D @resvg/resvg-js && node scripts/buildLogo.mjs
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const media = path.join(root, "media");

const GRAD = `<linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2563EB"/><stop offset="1" stop-color="#7C3AED"/></linearGradient>`;
const HEX = "86,50 68,18.8 32,18.8 14,50 32,81.2 68,81.2";
const BOLT = "M57 24 L38 54 L50 54 L44 76 L64 44 L52 44 Z";

// Full-colour master: white bolt on the rounded gradient hex.
const colourSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${GRAD}</defs><polygon points="${HEX}" fill="url(#lg)" stroke="url(#lg)" stroke-width="9" stroke-linejoin="round"/><path d="${BOLT}" fill="#fff"/></svg>`;

// Activity-bar SVG: mask the bolt out of the gradient hex so it reads as negative space
// under VS Code's icon tinting (and still looks right rendered in colour).
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    ${GRAD}
    <mask id="m"><polygon points="${HEX}" fill="#fff" stroke="#fff" stroke-width="9" stroke-linejoin="round"/><path d="${BOLT}" fill="#000"/></mask>
  </defs>
  <rect width="100" height="100" fill="url(#lg)" mask="url(#m)"/>
</svg>
`;

fs.writeFileSync(path.join(media, "logo_new.svg"), iconSvg);

let Resvg;
try {
  ({ Resvg } = await import("@resvg/resvg-js"));
} catch {
  console.error("[build-logo] wrote media/logo_new.svg. For the PNG, run: npm i -D @resvg/resvg-js && node scripts/buildLogo.mjs");
  process.exit(0);
}
const png = new Resvg(colourSvg, { fitTo: { mode: "width", value: 512 } }).render().asPng();
fs.writeFileSync(path.join(media, "logo_new.png"), png);
console.log("[build-logo] wrote media/logo_new.svg and media/logo_new.png (512x512)");
