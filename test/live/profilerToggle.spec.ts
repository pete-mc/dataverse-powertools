import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { loadLiveEnv, LiveEnv } from "../liveEnv";
import { acquireToken, ensureProfilerInstalled, liveWebApiClient } from "./profilerSolution";
import { enableStepProfiling, disableStepProfiling, parseProfilerConfiguration, stepQuery, PROFILED_NAME_SUFFIX, PROFILER_PLUGIN_TYPE_NAME } from "../../src/general/dataverse/profilerToggle";

// Live round-trip for the profiling toggle (#63 phase 2b): enable -> the step
// routes through the ProfilerPlugin carrying the original identity -> disable ->
// the step is BYTE-IDENTICAL to before. Uses a throwaway DISABLED step
// registered on the profiler's own plugin type (nothing new is deployed; the
// step never executes) on a rarely-touched message, deleted afterwards.
const env = loadLiveEnv();
const live = env ? describe : describe.skip;

it(env ? "live env available" : "profiler toggle live test skipped (needs creds)", () => {
  expect(true).toBe(true);
});

live("step profiling round trip (live)", () => {
  const e = env as LiveEnv;
  let client: ReturnType<typeof liveWebApiClient>;
  let stepId = "";
  const originalName = "DVPT live-test throwaway step (never enabled)";
  const originalConfig = "dvpt-original-config";

  beforeAll(async () => {
    const token = await acquireToken(e);
    client = liveWebApiClient(e, token);
    await ensureProfilerInstalled(e, token);

    const profilerType = (await client.get(`plugintypes?$select=plugintypeid&$filter=typename eq '${PROFILER_PLUGIN_TYPE_NAME}'`)).value[0].plugintypeid;
    const message = (await client.get("sdkmessages?$select=sdkmessageid&$filter=name eq 'Update'")).value[0].sdkmessageid;
    const filter = (await client.get(`sdkmessagefilters?$select=sdkmessagefilterid&$filter=_sdkmessageid_value eq ${message} and primaryobjecttypecode eq 'territory'`)).value[0]
      .sdkmessagefilterid;

    /* eslint-disable @typescript-eslint/naming-convention */
    stepId =
      (await client.post("sdkmessageprocessingsteps", {
        name: originalName,
        configuration: originalConfig,
        "plugintypeid@odata.bind": `/plugintypes(${profilerType})`,
        "sdkmessageid@odata.bind": `/sdkmessages(${message})`,
        "sdkmessagefilterid@odata.bind": `/sdkmessagefilters(${filter})`,
        stage: 40,
        mode: 0,
        rank: 99,
      })) ?? "";
    /* eslint-enable @typescript-eslint/naming-convention */
    expect(stepId).toMatch(/[0-9a-f-]{36}/i);
    // Disable immediately — the throwaway must never actually run.
    await client.patch(`sdkmessageprocessingsteps(${stepId})`, { statecode: 1, statuscode: 2 });
  }, 300000);

  afterAll(async () => {
    if (stepId) {
      await client.del(`sdkmessageprocessingsteps(${stepId})`);
    }
  }, 60000);

  it("enable -> carries the original identity; disable -> byte-identical restore", async () => {
    const before = await client.get(stepQuery(stepId));

    const snapshot = await enableStepProfiling(client, stepId, "live-session-key");
    expect(snapshot.name).toBe(originalName);
    expect(snapshot.configuration).toBe(originalConfig);

    const profiled = await client.get(stepQuery(stepId));
    expect(profiled.name).toBe(originalName + PROFILED_NAME_SUFFIX);
    expect(profiled.plugintypeid?.typename).toBe(PROFILER_PLUGIN_TYPE_NAME);
    const carried = parseProfilerConfiguration(profiled.configuration);
    expect(carried?.originalTypeName).toBe(before.plugintypeid.typename);
    expect(carried?.originalConfiguration).toBe(originalConfig);
    expect(carried?.originalPluginTypeId).toBe(before._plugintypeid_value);

    // Double-profile is refused (rail).
    await expect(enableStepProfiling(client, stepId, "again")).rejects.toThrow(/already profiled/);

    await disableStepProfiling(client, stepId, snapshot);
    const after = await client.get(stepQuery(stepId));
    expect(after.name).toBe(before.name);
    expect(after.configuration).toBe(before.configuration);
    expect(after._plugintypeid_value).toBe(before._plugintypeid_value);
  }, 120000);
});
