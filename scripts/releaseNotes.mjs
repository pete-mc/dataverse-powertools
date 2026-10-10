// Print the changelog section for one version — the body of that version's GitHub Release.
//
//   node scripts/releaseNotes.mjs <version>
//
// A full release's notes are its `## <version>` section in CHANGELOG.md; a pre-release's are its
// `## <version> (pre-release)` section in CHANGELOG-prerelease.md. Exits non-zero when neither file
// has the version, so the deploy workflow fails loudly instead of publishing an empty release.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version) {
  console.error("usage: node scripts/releaseNotes.mjs <version>");
  process.exit(2);
}

/** The body under the `## <version>` (or `## <version> (pre-release)`) heading, up to the next `## `. */
function section(file, heading) {
  const text = fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) {
    return undefined;
  }
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
}

const notes = section("CHANGELOG.md", `## ${version}`) ?? section("CHANGELOG-prerelease.md", `## ${version} (pre-release)`);
if (!notes) {
  console.error(`No changelog section for ${version} in CHANGELOG.md or CHANGELOG-prerelease.md.`);
  process.exit(1);
}
console.log(notes);
