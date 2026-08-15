// Report the integration suite's coverage of src/**, and enforce a floor.
//
// #143 asked for integration coverage to be measured "too" — until now only Vitest's numbers were
// reported, and they measure the OPPOSITE half of the codebase: unit coverage is high on extracted
// pure modules and necessarily ~0 on everything `vscode`-tangled, which is exactly the half the
// extension host executes. One number was being called "coverage" while the other went unmeasured.
//
// This reads the raw istanbul JSON that `vscode-test --coverage` writes and keeps only src/**,
// excluding the test sources themselves. That filtering has to happen here rather than in
// .vscode-test.mjs because test-cli 0.0.15 accepts `include`/`exclude` in its coverage config but
// doesn't apply them, so the raw report also covers every bundled dependency — with node_modules in
// the denominator the headline number says nothing about this codebase.
//
// Usage: node scripts/integrationCoverage.mjs [--json <path>] [--top N] [--no-threshold]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A regression guard, not a target — same contract as the Vitest floor in vitest.config.ts. Kept a
// couple of points below the actual so it isn't brittle. Ratchet UP as integration tests land;
// never down.
export const INTEGRATION_COVERAGE_FLOOR = { statements: 34, functions: 13 };

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const jsonPath = path.resolve(root, flag("--json", path.join("coverage-integration", "coverage-final.json")));
const topCount = Number(flag("--top", "12"));
const enforce = !args.includes("--no-threshold");

if (!fs.existsSync(jsonPath)) {
  console.error(`[integration-coverage] no coverage at ${jsonPath}.\nRun: npm run test:integration:coverage`);
  process.exit(1);
}

/** Only this repo's own sources, and not the test sources themselves. */
function isOwnSource(file) {
  const normalized = file.replace(/\\/g, "/").toLowerCase();
  const srcRoot = `${root.replace(/\\/g, "/").toLowerCase()}/src/`;
  if (!normalized.startsWith(srcRoot)) {
    return false;
  }
  const relative = normalized.slice(srcRoot.length);
  return !relative.startsWith("test/") && !relative.startsWith("ui-test/") && !relative.endsWith(".spec.ts");
}

const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const files = Object.entries(report).filter(([file]) => isOwnSource(file));

if (files.length === 0) {
  // A silent zero here would read as "nothing is covered" when the truth is "nothing was measured".
  console.error("[integration-coverage] the report contains no src/** entries — the bundle's source map did not resolve back to source.");
  console.error("Check webpack.config.js output.devtoolModuleFilenameTemplate and that `npm run compile` ran before the tests.");
  process.exit(1);
}

const counted = (map) => Object.values(map ?? {});
const hit = (values) => values.filter((v) => (typeof v === "number" ? v > 0 : v)).length;

let statements = 0;
let statementsHit = 0;
let functions = 0;
let functionsHit = 0;
let branches = 0;
let branchesHit = 0;
const perFile = [];

for (const [file, data] of files) {
  const s = counted(data.s);
  const f = counted(data.f);
  const b = counted(data.b).flat();
  statements += s.length;
  statementsHit += hit(s);
  functions += f.length;
  functionsHit += hit(f);
  branches += b.length;
  branchesHit += hit(b);
  if (s.length > 0) {
    perFile.push({
      file: path.relative(root, file).replace(/\\/g, "/"),
      statements: s.length,
      covered: hit(s),
      pct: (hit(s) / s.length) * 100,
      functions: f.length,
      functionsHit: hit(f),
    });
  }
}

const pct = (part, total) => (total === 0 ? 100 : (part / total) * 100);
const format = (part, total) => `${pct(part, total).toFixed(2).padStart(6)}% ( ${part}/${total} )`;

console.log("");
console.log("========== Integration coverage (extension host, src/** only) ==========");
console.log(`Files        : ${files.length}`);
console.log(`Statements   : ${format(statementsHit, statements)}`);
console.log(`Branches     : ${format(branchesHit, branches)}`);
console.log(`Functions    : ${format(functionsHit, functions)}`);
console.log("========================================================================");

if (topCount > 0) {
  const covered = perFile.filter((entry) => entry.covered > 0).sort((a, b) => b.pct - a.pct || b.statements - a.statements);
  console.log(`\nMost-exercised sources (top ${Math.min(topCount, covered.length)} of ${covered.length} with any coverage):`);
  for (const entry of covered.slice(0, topCount)) {
    console.log(`  ${entry.pct.toFixed(1).padStart(5)}%  ${entry.file}  (${entry.covered}/${entry.statements})`);
  }
  // Statement coverage flatters this suite: every bundled module's top level runs at require time,
  // so almost nothing reads as 0%. Files where no FUNCTION was ever entered are the honest measure
  // of what the integration suite doesn't reach.
  const noFunctionEntered = perFile.filter((entry) => entry.functions > 0 && entry.functionsHit === 0);
  console.log(`\n${noFunctionEntered.length} of ${perFile.length} source file(s) are loaded but have no function the integration suite ever enters.`);
}

if (enforce) {
  const failures = [];
  if (pct(statementsHit, statements) < INTEGRATION_COVERAGE_FLOOR.statements) {
    failures.push(`statements ${pct(statementsHit, statements).toFixed(2)}% < ${INTEGRATION_COVERAGE_FLOOR.statements}%`);
  }
  if (pct(functionsHit, functions) < INTEGRATION_COVERAGE_FLOOR.functions) {
    failures.push(`functions ${pct(functionsHit, functions).toFixed(2)}% < ${INTEGRATION_COVERAGE_FLOOR.functions}%`);
  }
  if (failures.length > 0) {
    console.error(`\n[integration-coverage] below the floor: ${failures.join(", ")}`);
    process.exit(1);
  }
}
