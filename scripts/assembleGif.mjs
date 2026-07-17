// Assemble a slideshow GIF from a list of PNG frames (pure JS: pngjs decode + gifenc encode).
// Usage: node scripts/assembleGif.mjs <out.gif> <delayMs> <frame1.png> [frame2.png ...]
// Frames are padded to the max width/height on a dark canvas so mixed sizes align.
import fs from "fs";
import { PNG } from "pngjs";
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

const [, , outPath, delayStr, ...frames] = process.argv;
if (!outPath || frames.length === 0) {
  console.error("usage: assembleGif.mjs <out.gif> <delayMs> <frame.png>...");
  process.exit(2);
}
const delay = Number(delayStr) || 1500;
const BG = [24, 24, 24, 255]; // VS Code dark editor background

const decoded = frames.map((f) => {
  const png = PNG.sync.read(fs.readFileSync(f));
  return { w: png.width, h: png.height, data: png.data };
});
const W = Math.max(...decoded.map((d) => d.w));
const H = Math.max(...decoded.map((d) => d.h));

const enc = GIFEncoder();
for (const d of decoded) {
  // Center each frame on a W×H dark canvas.
  const canvas = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    canvas[i * 4] = BG[0];
    canvas[i * 4 + 1] = BG[1];
    canvas[i * 4 + 2] = BG[2];
    canvas[i * 4 + 3] = 255;
  }
  const ox = Math.floor((W - d.w) / 2);
  const oy = Math.floor((H - d.h) / 2);
  for (let y = 0; y < d.h; y++) {
    for (let x = 0; x < d.w; x++) {
      const src = (y * d.w + x) * 4;
      const dst = ((y + oy) * W + (x + ox)) * 4;
      canvas[dst] = d.data[src];
      canvas[dst + 1] = d.data[src + 1];
      canvas[dst + 2] = d.data[src + 2];
      canvas[dst + 3] = 255;
    }
  }
  const palette = quantize(canvas, 256);
  const index = applyPalette(canvas, palette);
  enc.writeFrame(index, W, H, { palette, delay });
}
enc.finish();
fs.writeFileSync(outPath, Buffer.from(enc.bytes()));
console.log(`wrote ${outPath} (${frames.length} frames, ${W}x${H}, ${delay}ms each)`);
