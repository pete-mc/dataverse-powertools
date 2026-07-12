import * as fs from "fs";
import { resetAllCredentials } from "./lib";

// Final suite (the zz prefix makes the e2e glob run it last): leave the machine with NO
// credentials — no pac auth profiles, no extension secrets, no MSAL token cache. The next
// run then starts from a genuinely clean slate, so "works only because of leftover auth"
// bugs (like the no-active-environment earlybound failure) can't hide between runs.
// The seeded MSAL cache FILE is also removed; the launcher re-seeds it every run.
describe("Credential cleanup (e2e)", function () {
  this.timeout(120000);

  it("clears all pac and extension credentials", async () => {
    const log = (m: string) => console.log(`    [e2e] ${m}`);
    await resetAllCredentials(log);
    const cacheFile = process.env.DVPT_TEST_MSAL_CACHE_FILE;
    if (cacheFile && fs.existsSync(cacheFile)) {
      try {
        fs.unlinkSync(cacheFile);
        log("[reset] seeded MSAL cache file removed");
      } catch {
        /* locked — the launcher overwrites it next run anyway */
      }
    }
  });
});
