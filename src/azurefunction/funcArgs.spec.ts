import { describe, it, expect } from "vitest";
import { funcAzurePublishArgs, funcStartArgs, toCommandLine } from "./funcArgs";

describe("funcAzurePublishArgs", () => {
  it("builds the publish command for an app", () => {
    expect(funcAzurePublishArgs("my-func-app")).toEqual(["azure", "functionapp", "publish", "my-func-app"]);
  });
});

describe("funcStartArgs", () => {
  it("is just start", () => {
    expect(funcStartArgs()).toEqual(["start"]);
  });
});

describe("toCommandLine", () => {
  it("joins program + args", () => {
    expect(toCommandLine("func", ["azure", "functionapp", "publish", "app"])).toBe("func azure functionapp publish app");
  });
  it("quotes args with spaces", () => {
    expect(toCommandLine("func", ["azure", "functionapp", "publish", "my app"])).toBe('func azure functionapp publish "my app"');
  });
});
