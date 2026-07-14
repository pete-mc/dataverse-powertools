import { describe, it, expect } from "vitest";
import { parseCsv, toArray, applyDefaults, LOG_LEVELS } from "./settingsFile";

// Pure helpers behind the plugin model-builder (earlybound) settings. parseCsv is the
// CSV/array normaliser for the entity/message filters; applyDefaults fills a partial
// settings object. (The module imports vscode for getWorkspacePath, but these functions
// don't touch it — vitest aliases vscode to the mock.)

describe("parseCsv", () => {
  it("returns [] for empty / nullish input", () => {
    expect(parseCsv(undefined)).toEqual([]);
    expect(parseCsv(null)).toEqual([]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv([])).toEqual([]);
  });

  it("splits a comma string, trims, and drops empty entries", () => {
    expect(parseCsv("account, contact ,, lead")).toEqual(["account", "contact", "lead"]);
  });

  it("dedupes case-insensitively, keeping the first occurrence's casing", () => {
    expect(parseCsv("Account, account, Contact, ACCOUNT")).toEqual(["Account", "Contact"]);
  });

  it("normalises an array the same way as a string", () => {
    expect(parseCsv([" Account ", "account", "", "Contact"])).toEqual(["Account", "Contact"]);
  });

  it("toArray is parseCsv over an array", () => {
    expect(toArray(["a", "a", "b"])).toEqual(["a", "b"]);
  });
});

describe("applyDefaults", () => {
  it("fills every field with its default from an empty object", () => {
    const settings = applyDefaults({});
    expect(settings.namespace).toBe("Dataverse.Plugins");
    expect(settings.serviceContextName).toBe("XrmSvc");
    expect(settings.outputDirectory).toBe("generated");
    expect(settings.entityTypesFolder).toBe("Entities");
    expect(settings.messagesTypesFolder).toBe("Messages");
    expect(settings.optionSetsTypesFolder).toBe("OptionSets");
    expect(settings.logLevel).toBe("Information");
    expect(settings.entityNamesFilter).toEqual([]);
    expect(settings.messageNamesFilter).toEqual([]);
    // Every boolean defaults to false.
    for (const key of [
      "emitEntityEtc",
      "emitFieldsClasses",
      "emitVirtualAttributes",
      "generateGlobalOptionSets",
      "generateSdkMessages",
      "suppressGeneratedCodeAttribute",
      "suppressINotifyPattern",
    ] as const) {
      expect(settings[key], key).toBe(false);
    }
  });

  it("respects provided values and normalises the filters through parseCsv", () => {
    const settings = applyDefaults({
      namespace: "My.Ns",
      emitEntityEtc: true,
      entityNamesFilter: "account, Account, contact" as any,
      messageNamesFilter: ["Create", "create"] as any,
    });
    expect(settings.namespace).toBe("My.Ns");
    expect(settings.emitEntityEtc).toBe(true);
    expect(settings.entityNamesFilter).toEqual(["account", "contact"]);
    expect(settings.messageNamesFilter).toEqual(["Create"]);
  });

  it("falls back to Information for an invalid logLevel and keeps a valid one", () => {
    expect(applyDefaults({ logLevel: "Bogus" as any }).logLevel).toBe("Information");
    expect(applyDefaults({ logLevel: "Verbose" }).logLevel).toBe("Verbose");
    expect(LOG_LEVELS).toContain("Verbose");
  });

  it("preserves an explicit false vs undefined (?? semantics)", () => {
    expect(applyDefaults({ emitEntityEtc: false }).emitEntityEtc).toBe(false);
    expect(applyDefaults({ emitEntityEtc: true }).emitEntityEtc).toBe(true);
  });
});
