// Roll the accumulated pre-release notes into the stable changelog at a full release.
//
// Usage: node scripts/rollupChangelog.mjs <version> [--summary "one-line headline"] [--dry-run]
//
// What it does:
//   1. takes every `## x.y.z (pre-release)` section out of CHANGELOG-prerelease.md,
//   2. inserts them into CHANGELOG.md under a single `## <version>` heading (newest first,
//      each keeping its own sub-heading so nothing is lost),
//   3. clears CHANGELOG-prerelease.md back to its header so the next cycle starts empty.
//
// Nothing else touches these files, so the pre-release log can stay as verbose as it likes
// while the Marketplace changelog only grows one section per full release.
import fs from "fs";
import path from "path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const STABLE = path.join(repoRoot, "CHANGELOG.md");
const PRERELEASE = path.join(repoRoot, "CHANGELOG-prerelease.md");
const NL = "\r\n";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const summaryIndex = args.indexOf("--summary");
const summary = summaryIndex === -1 ? undefined : args[summaryIndex + 1];
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));

if (!version) {
  console.error('usage: node scripts/rollupChangelog.mjs <version> [--summary "headline"] [--dry-run]');
  process.exit(2);
}

const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const write = (file, text) => fs.writeFileSync(file, text.replace(/\n/g, NL));

const prerelease = read(PRERELEASE);
const stable = read(STABLE);

// Header = everything before the first version heading; body = the accumulated sections.
const firstHeading = prerelease.search(/^## /m);
if (firstHeading === -1) {
  console.error(`${path.basename(PRERELEASE)} has no pre-release sections to roll up.`);
  process.exit(1);
}
const prereleaseHeader = prerelease.slice(0, firstHeading).replace(/\s+$/, "");
const sections = prerelease.slice(firstHeading).replace(/\s+$/, "");
const versions = [...sections.matchAll(/^## (\S+)/gm)].map((m) => m[1]);

// The rolled-up section: the new stable heading, an optional headline, then every
// pre-release section demoted to `###` so they nest under it.
const rolled = [`## ${version}`, "", ...(summary ? [summary, ""] : []), sections.replace(/^## /gm, "### "), ""].join("\n");

// Insert directly above the newest existing stable section, replacing the Unreleased pointer.
const unreleased = stable.match(/^## Unreleased\n[\s\S]*?(?=^## )/m);
const updatedStable = unreleased ? stable.replace(unreleased[0], rolled + "\n") : stable.replace(/^## /m, `${rolled}\n## `);

const clearedPrerelease = [prereleaseHeader, "", "_Nothing yet — the next pre-release adds its section here._", ""].join("\n");

if (dryRun) {
  console.log(`Would roll ${versions.length} pre-release section(s) (${versions[versions.length - 1]} → ${versions[0]}) into ## ${version}.`);
  process.exit(0);
}

write(STABLE, updatedStable);
write(PRERELEASE, clearedPrerelease);
console.log(`Rolled ${versions.length} pre-release section(s) (${versions[versions.length - 1]} → ${versions[0]}) into ## ${version} in CHANGELOG.md; CHANGELOG-prerelease.md cleared.`);
