import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { loadLiveEnv, LiveEnv, testSolutionConfig } from "../liveEnv";
import { LiveDataverseClient } from "./dataverseClient";
import { DataverseWebresource } from "../../src/general/dataverse/DataverseWebresource";
import DataversePowerToolsContext from "../../src/context";

// End-to-end feature test: drive the EXTENSION'S OWN code (DataverseWebresource) against
// the real environment, place the result in the dedicated test solution, verify via an
// independent Web API client, then clean up. Template for validating everything the tool does.
const env = loadLiveEnv();

it(env ? "live env configured for webresource round-trip" : "live env NOT configured — skipping (see TESTING.md)", () => {
  expect(true).toBe(true);
});

const live = env ? describe : describe.skip;

/** Minimal stand-in for DataversePowerToolsContext — just what DataverseWebresource touches. */
function fakeContext(url: string, token: string): DataversePowerToolsContext {
  return {
    dataverse: { organizationUrl: url, isValid: true, getAuthorizationToken: async () => token },
    channel: { appendLine: () => undefined },
  } as unknown as DataversePowerToolsContext;
}

live("webresource deploy round-trip (extension code → test solution → verify)", () => {
  const client = new LiveDataverseClient(env as LiveEnv);
  const solutionCfg = testSolutionConfig(env);
  let solutionUniqueName = "";
  let solutionId = "";
  let webresourceName = "";
  let createdId: string | undefined;

  beforeAll(async () => {
    await client.connect();
    const solution = await client.ensureTestSolution(solutionCfg);
    solutionUniqueName = solution.uniqueName;
    solutionId = solution.solutionId;
    webresourceName = `${solutionCfg.prefix}_dvpttest/roundtrip_${Date.now()}.js`;
  });

  afterAll(async () => {
    if (createdId) {
      await client.deleteWebresource(createdId);
    }
  });

  it("ensures the dedicated test solution exists", () => {
    expect(solutionId, "test solution was not created").toBeTruthy();
  });

  it("upserts via the extension's DataverseWebresource, adds it to the test solution, and it lands in Dataverse", async () => {
    const source = `console.log("dvpt roundtrip ${Date.now()}");`;
    const contentBase64 = Buffer.from(source, "utf8").toString("base64");

    // 3 = JScript webresource type. Then add it to the dedicated test solution.
    const webresource = new DataverseWebresource(webresourceName, fakeContext((env as LiveEnv).url, client.accessToken));
    await webresource.upsert(contentBase64, 3, "roundtrip.js");
    await webresource.addToSolution(solutionUniqueName);

    const found = await client.findWebresourceByName(webresourceName);
    expect(found, "webresource not found in Dataverse after upsert").toBeTruthy();
    createdId = found?.webresourceid;
    expect(Buffer.from(found?.content ?? "", "base64").toString("utf8")).toBe(source);

    expect(await client.isComponentInSolution(solutionId, createdId as string), "webresource is not a member of the test solution").toBe(true);
  });
});
