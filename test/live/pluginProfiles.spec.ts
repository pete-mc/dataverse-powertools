import { describe, it, expect, beforeAll } from "vitest";
import { loadLiveEnv, LiveEnv } from "../liveEnv";
import { profilerInstalledQuery, pluginProfilesQuery } from "../../src/general/dataverse/pluginProfiles";
import { acquireToken, webApi, ensureProfilerInstalled } from "./profilerSolution";

// Live proof for #63 phase 2a: the EXACT queries the extension issues work
// against a real org with the Plugin Profiler installed. Installs the profiler
// managed solution into the sandbox org on first run (idempotent, from the PRT
// NuGet). Self-skips without creds.
const env = loadLiveEnv();
const live = env ? describe : describe.skip;

it(env ? "live env available" : "plugin profiles live test skipped (needs creds)", () => {
  expect(true).toBe(true);
});

live("captured plugin profiles (live)", () => {
  const e = env as LiveEnv;
  let token = "";

  beforeAll(async () => {
    token = await acquireToken(e);
    const state = await ensureProfilerInstalled(e, token);
    console.log(`[live] PluginProfiler solution: ${state}`);
  }, 300000);

  it("detects the installed profiler via the extension's query", async () => {
    const result = await webApi(e, token, "GET", profilerInstalledQuery());
    expect(result.status).toBe(200);
    expect(result.body.value?.length).toBe(1);
  });

  it("lists captured profiles via the extension's query (empty org is fine)", async () => {
    const result = await webApi(e, token, "GET", pluginProfilesQuery(10));
    expect(result.status, JSON.stringify(result.body).slice(0, 300)).toBe(200);
    expect(Array.isArray(result.body.value)).toBe(true);
  });
});
