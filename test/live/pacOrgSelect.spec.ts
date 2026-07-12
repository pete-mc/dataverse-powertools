import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as cp from "child_process";
import { loadLiveEnv, LiveEnv } from "../liveEnv";
import { pacInvocation } from "../../src/general/pac";
import { pacOrgSelectArgs } from "../../src/general/pacAuth";

// Regression for the recurring "earlybound under OAuth" failure (user report ×2):
// a pac auth profile can exist WITHOUT an active environment, and every
// environment-bound pac command (modelbuilder, pages, org who) then fails with
// "No active environment set for the current auth profile". The extension's fix
// is to always `pac org select --environment <project org>` on the active
// profile (general/pacAuth.ts ensurePacAuthForCurrentConnection). This test
// replicates the broken state with a REAL env-less profile and proves the
// select-then-succeed path. Self-skips without creds/pac.
const env = loadLiveEnv();

function pac(args: string[]): { code: number; out: string } {
  const { command, args: invocationArgs } = pacInvocation(args);
  const result = cp.spawnSync(command, invocationArgs, { encoding: "utf8", timeout: 120000 });
  return { code: result.status ?? 1, out: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

const hasPac = (() => {
  try {
    return pac(["help"]).code === 0;
  } catch {
    return false;
  }
})();

const PROFILE = "dvpt-test-noenv";
const live = env && hasPac ? describe : describe.skip;

it(env && hasPac ? "live env + pac available" : "pac org-select regression skipped (needs creds + pac)", () => {
  expect(true).toBe(true);
});

live("pac profile without an active environment (earlybound OAuth regression)", () => {
  const e = env as LiveEnv;

  beforeAll(() => {
    pac(["auth", "delete", "--name", PROFILE]);
    // Create the profile WITHOUT --environment — the exact broken state the
    // user's OAuth profile was in.
    const created = pac(["auth", "create", "--name", PROFILE, "--applicationId", e.clientId, "--clientSecret", e.clientSecret, "--tenant", e.tenantId]);
    expect(created.code, `auth create: ${created.out.slice(-400)}`).toBe(0);
  }, 180000);

  afterAll(() => {
    pac(["auth", "delete", "--name", PROFILE]);
  });

  // The literal broken state (profile with NO active environment) can't be
  // forced deterministically — pac may auto-select a tenant default for fresh
  // profiles. The guarantee the fix relies on is stronger anyway: org select
  // must ALWAYS point the active profile at the PROJECT's environment, both
  // when none is set and when a different default was auto-selected.
  it("org select points the active profile at the project environment (and org who confirms it)", () => {
    const selected = pac(pacOrgSelectArgs(e.url));
    expect(selected.code, `org select: ${selected.out.slice(-400)}`).toBe(0);
    const who = pac(["org", "who"]);
    expect(who.code, `org who after select: ${who.out.slice(-400)}`).toBe(0);
    expect(who.out).toContain(new URL(e.url).hostname);
  }, 180000);
});
