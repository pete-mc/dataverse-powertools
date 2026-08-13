// Compose two captures into one side-by-side frame — the editor on the left, the live app on the right.
//
// Usage:
//   node scripts/composeSideBySide.mjs <left.png> <right.png> <out.png> ["Left caption"] ["Right caption"]
//
// #231 asked for split-screen GIFs of the hot-reload flows (VS Code editing, the browser updating). A
// recording is not reproducible — it drifts from the product the first time a label changes, and nobody
// can diff it. Two frames captured by the SUITE, at the moments it has already asserted are correct,
// composed here, say the same thing and stay honest: the editor half and the app half are each real
// screenshots of a run that passed.
//
// Pure JS on pngjs (already a dependency, same as scripts/assembleGif.mjs) so it runs anywhere with no
// image tooling installed.
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";

const GAP = 16; // separator between the panes
const BAND = 34; // caption band height, 0 when there are no captions
const BG = { r: 24, g: 24, b: 27 }; // matches the VS Code dark chrome the frames carry

/** Blit `src` into `dst` at (dx, dy), clipped to `dst`. */
function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) {
      continue;
    }
    for (let x = 0; x < src.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) {
        continue;
      }
      const s = (src.width * y + x) << 2;
      const d = (dst.width * ty + tx) << 2;
      dst.data[d] = src.data[s];
      dst.data[d + 1] = src.data[s + 1];
      dst.data[d + 2] = src.data[s + 2];
      dst.data[d + 3] = 255;
    }
  }
}

function fill(png, colour) {
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = colour.r;
    png.data[i + 1] = colour.g;
    png.data[i + 2] = colour.b;
    png.data[i + 3] = 255;
  }
}

/**
 * A 5x7 bitmap font, enough for captions. Drawing text without a font library keeps this dependency-free;
 * anything more elaborate belongs in the page's markdown, not burned into the image.
 */
const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "11110", "10001", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
  F: ["11111", "10000", "11110", "10000", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "11111", "10001", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "01110", "00001", "00001", "10001", "01110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "01010", "00100", "00100", "00100", "01010", "10001"],
  Y: ["10001", "01010", "00100", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00010", "00100", "01000", "10000", "10000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00000", "00100"],
  ":": ["00000", "00100", "00000", "00000", "00100", "00000", "00000"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
};

/**
 * Refuse a caption this font cannot draw.
 *
 * Unknown characters used to render as blanks, so "Set a breakpoint" came out "SET A BREA POINT" — the
 * image looked fine and said something else. A caption that cannot be drawn is a bug in the caller, not
 * something to paper over.
 */
function assertDrawable(text, which) {
  const missing = [...new Set([...(text ?? "").toUpperCase()])].filter((character) => !(character in GLYPHS));
  if (missing.length > 0) {
    console.error(`${which} caption uses characters this font has no glyph for: ${missing.join(" ")}`);
    console.error("Add them to GLYPHS or reword the caption — silently dropping them would misspell the image.");
    process.exit(1);
  }
}

function drawText(png, text, x, y, scale = 2) {
  let cursor = x;
  for (const rawChar of text.toUpperCase()) {
    const glyph = GLYPHS[rawChar] ?? GLYPHS[" "];
    for (let gy = 0; gy < glyph.length; gy++) {
      for (let gx = 0; gx < glyph[gy].length; gx++) {
        if (glyph[gy][gx] !== "1") {
          continue;
        }
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = cursor + gx * scale + sx;
            const py = y + gy * scale + sy;
            if (px < 0 || px >= png.width || py < 0 || py >= png.height) {
              continue;
            }
            const o = (png.width * py + px) << 2;
            png.data[o] = 230;
            png.data[o + 1] = 230;
            png.data[o + 2] = 235;
            png.data[o + 3] = 255;
          }
        }
      }
    }
    cursor += (5 + 1) * scale;
  }
}

const [leftPath, rightPath, outPath, leftCaption, rightCaption] = process.argv.slice(2);
if (!leftPath || !rightPath || !outPath) {
  console.error('usage: node scripts/composeSideBySide.mjs <left.png> <right.png> <out.png> ["Left caption"] ["Right caption"]');
  process.exit(2);
}
for (const file of [leftPath, rightPath]) {
  if (!fs.existsSync(file)) {
    console.error(`missing input: ${file} — run the suite that captures it first (nothing is composed from a stale frame)`);
    process.exit(1);
  }
}

const left = PNG.sync.read(fs.readFileSync(leftPath));
const right = PNG.sync.read(fs.readFileSync(rightPath));
const band = leftCaption || rightCaption ? BAND : 0;
const height = Math.max(left.height, right.height) + band;
const out = new PNG({ width: left.width + GAP + right.width, height });
fill(out, BG);
blit(out, left, 0, band);
blit(out, right, left.width + GAP, band);
if (band) {
  assertDrawable(leftCaption, "left");
  assertDrawable(rightCaption, "right");
  drawText(out, (leftCaption ?? "").slice(0, 60), 8, 9);
  drawText(out, (rightCaption ?? "").slice(0, 60), left.width + GAP + 8, 9);
}
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, PNG.sync.write(out));
console.log(`composed ${path.basename(outPath)} — ${out.width}x${out.height} (${path.basename(leftPath)} | ${path.basename(rightPath)})`);
