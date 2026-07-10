/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, beforeAll, expect } from "vitest";
import * as fs from "fs";
import * as vscode from "vscode"; // aliased to test/vscode.mock.ts
import { loadLiveEnv, LiveEnv } from "../liveEnv";
import { acquireInteractiveToken } from "../../src/general/dataverse/tokenAcquisition";

// Validates the DVPT_TEST_MSAL_CACHE_FILE seam: with a pre-seeded interactive cache (written by
// preAcquireInteractiveCache.mjs in a prior process), the extension's interactive auth resolves a
// token SILENTLY — no browser. This is what lets the ExTester wizard connect interactively.
const env = loadLiveEnv();
const cacheFile = process.env.DVPT_TEST_MSAL_CACHE_FILE;
const enabled = !!env && !!cacheFile && fs.existsSync(cacheFile || "") && process.env.DVPT_DEBUG_DEMO === "1";
const suite = enabled ? describe : describe.skip;

suite("Interactive connect is silent from a pre-seeded cache", () => {
  const e = env as LiveEnv;

  beforeAll(() => {
    // If the interactive flow tries to open a browser, that means it wasn't silent — fail loudly.
    (vscode as unknown as { env: unknown }).env = {
      openExternal: async () => {
        throw new Error("openExternal called — interactive connect was NOT silent");
      },
    };
  });

  it("acquires an interactive token without opening a browser", async () => {
    const res = await acquireInteractiveToken(e.url, undefined, /* promptIfNeeded */ false);
    expect(res?.accessToken, "no silent token — the pre-seeded cache was not used").toBeTruthy();
  });
});
