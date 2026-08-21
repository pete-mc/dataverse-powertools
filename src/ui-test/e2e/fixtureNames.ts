// Pure fixture-name scoping for the e2e suites (#258).
//
// Every suite creates rows in ONE shared Dataverse environment, so two runs that overlap —
// a CI job and a developer's box, or two developers — will delete each other's fixtures and
// assert against each other's leftovers unless the names differ. That has already produced a
// real false pass (#249): an "the web resource exists" assertion satisfied by a DIFFERENT
// suite's row, proving nothing.
//
// This module holds the naming rules and nothing else — no selenium, no `vscode`, no I/O — so
// it runs in the ordinary vitest layer rather than only inside an hour-long ExTester run. The
// suites reach it through `runScopedName` / `runScopedIdentifier` in lib.ts, which supply the
// current run's id.

/** The run id used when the suite was NOT launched through `scripts/runE2E.mjs`, which is the
 * only thing that sets `DVPT_E2E_RUN_ID`. A bare `extest` run keeps the unscoped names, so a
 * developer debugging one suite still gets the short, readable fixtures they can recognise in
 * the org — the isolation only matters when runs actually overlap, and a bare run is a
 * deliberate solo one. */
export const LOCAL_RUN_ID = "local";

/** `scripts/runE2E.mjs` generates base-36 minutes-since-epoch. Anything outside this set would
 * either break a C# identifier or need OData escaping at every call site. */
const RUN_ID_PATTERN = /^[a-z0-9]+$/i;

/** C# and TypeScript agree on this much: a leading letter/underscore, then word characters. */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Reject a run id that would produce an unusable or unsafe fixture name, at the point the name
 * is built rather than minutes later inside a `dotnet build` or an OData filter. */
export function assertUsableRunId(runId: string): void {
  if (runId === LOCAL_RUN_ID) {
    return;
  }
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`DVPT_E2E_RUN_ID must be alphanumeric (got ${JSON.stringify(runId)}) — it is appended to Dataverse names and C# identifiers.`);
  }
}

/**
 * `base` with this run's id appended, for a fixture that lives in the shared environment.
 *
 * Deliberately a SUFFIX, not a prefix: plug-in package names carry the publisher prefix at the
 * front (`dvpt_AcceptancePlugin`) and web-resource names are matched by their leading prefix, so
 * anything prepended would either be stripped or break the lookup.
 */
export function scopedName(base: string, runId: string): string {
  if (!base) {
    throw new Error("scopedName needs a non-empty base — an unnamed fixture cannot be cleaned up by name.");
  }
  assertUsableRunId(runId);
  return runId === LOCAL_RUN_ID ? base : `${base}${runId}`;
}

/**
 * As `scopedName`, for a base that also has to be a legal C#/TypeScript identifier — a plug-in
 * project, namespace or class name, or a web-resource class.
 *
 * These reach a compiler rather than the Web API, so a name that scoping made illegal surfaces
 * as a build error deep into a suite. Checking here names the cause instead.
 */
export function scopedIdentifier(base: string, runId: string): string {
  if (!IDENTIFIER_PATTERN.test(base)) {
    throw new Error(`fixture base ${JSON.stringify(base)} is not a legal identifier — it is used as a C#/TypeScript name.`);
  }
  const name = scopedName(base, runId);
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new Error(`scoping ${JSON.stringify(base)} with run id ${JSON.stringify(runId)} produced ${JSON.stringify(name)}, which is not a legal identifier.`);
  }
  return name;
}

/** What a profiler clone step found on a shared entity should have done to it. */
export type StepDisposition = "delete" | "foreign" | "keep";

/**
 * Decide the fate of one `sdkmessageprocessingstep` row during the profiler suite's cleanup.
 *
 * The profiler works by CLONING a step onto its own plug-in type and disabling the original, so
 * the rows worth deleting are the clones: their plug-in type is the profiler's, or their name ends
 * in "(Profiler)"/"(Profiled)". Everything else on the entity belongs to the org, not to us.
 *
 * `ownedMarker` narrows that to the current run (#258). A clone inherits the original step's name,
 * so a run id registered into the step name is still present on the clone — which is the only
 * thing distinguishing two concurrent runs' clones on the same entity. Without the marker the
 * sweep is org-wide, which is what a solo local run wants and what an overlapping run must not do.
 */
export function profilerStepDisposition(stepName: string, pluginTypeName: string, ownedMarker?: string): StepDisposition {
  const isClone = /ProfilerPlugin/.test(pluginTypeName) || /\((Profiler|Profiled)\)\s*$/.test(stepName);
  if (!isClone) {
    return "keep";
  }
  if (ownedMarker && !stepName.includes(ownedMarker)) {
    return "foreign";
  }
  return "delete";
}
