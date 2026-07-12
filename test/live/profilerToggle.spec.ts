import { describe, it, expect, beforeAll } from "vitest";
import { loadLiveEnv, LiveEnv } from "../liveEnv";
import { acquireToken, ensureProfilerInstalled, liveWebApiClient } from "./profilerSolution";
import { profilerPluginTypeQuery, PROFILER_PLUGIN_TYPE_NAME } from "../../src/general/dataverse/profilerToggle";

// Live check for the profiler toggle building blocks (#63/Option A). The FULL
// enable→capture→restore round trip is covered end-to-end by the
// pluginProfilerReplay e2e (it needs a real deployed plugin step to profile,
// which this headless spec can't create). Here we just prove the profiler
// solution installs and its ProfilerPlugin type is queryable. Self-skips
// without creds.
const env = loadLiveEnv();
const live = env ? describe : describe.skip;

it(env ? "live env available" : "profiler toggle live test skipped (needs creds)", () => {
  expect(true).toBe(true);
});

live("profiler solution + plugin type (live)", () => {
  const e = env as LiveEnv;
  let client: ReturnType<typeof liveWebApiClient>;

  beforeAll(async () => {
    const token = await acquireToken(e);
    client = liveWebApiClient(e, token);
    await ensureProfilerInstalled(e, token);
  }, 300000);

  it("resolves the ProfilerPlugin type via the extension's query", async () => {
    const result = await client.get(profilerPluginTypeQuery());
    expect(result.value?.length, `${PROFILER_PLUGIN_TYPE_NAME} plugin type present`).toBe(1);
    expect(result.value[0].plugintypeid).toMatch(/[0-9a-f-]{36}/i);
  });
});
