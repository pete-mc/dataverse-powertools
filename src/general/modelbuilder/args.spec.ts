import { describe, it, expect } from "vitest";
import { buildModelBuilderArgs, joinPacFilter, PAC_FILTER_SEPARATOR } from "./args";

const base = { namespace: "Contoso.Plugins", serviceContextName: "Ctx", outputDirectory: "EarlyBound" };
/** The value pac actually receives for a flag. */
const valueOf = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("buildModelBuilderArgs", () => {
  it("always emits the required flags", () => {
    expect(buildModelBuilderArgs(base)).toEqual(["modelbuilder", "build", "--namespace", "Contoso.Plugins", "--serviceContextName", "Ctx", "--outdirectory", "EarlyBound"]);
  });

  // The bug: joined with "," pac 2.8.1 treats the whole string as ONE entity name, matches
  // nothing, reports "Read 0 Entities", writes no classes and STILL EXITS 0 — so the command
  // looked successful and left an empty generated folder. Verified against 2.8.1+ga4eb71c.
  describe("filters are SEMICOLON separated, as pac documents", () => {
    it("joins the entity filter with semicolons, never commas", () => {
      const args = buildModelBuilderArgs({ ...base, entityNamesFilter: ["team", "teamtemplate"] });
      expect(valueOf(args, "--entityNamesFilter")).toBe("team;teamtemplate");
      expect(valueOf(args, "--entityNamesFilter")).not.toContain(",");
    });

    it("joins the message filter with semicolons too — the same flag family, same rule", () => {
      const args = buildModelBuilderArgs({ ...base, messageNamesFilter: ["Create", "Update"] });
      expect(valueOf(args, "--messageNamesFilter")).toBe("Create;Update");
      expect(valueOf(args, "--messageNamesFilter")).not.toContain(",");
    });

    it("pins the separator so it can't be 'tidied' back to a comma", () => {
      expect(PAC_FILTER_SEPARATOR).toBe(";");
    });

    it("passes a single entity through unchanged", () => {
      expect(valueOf(buildModelBuilderArgs({ ...base, entityNamesFilter: ["account"] }), "--entityNamesFilter")).toBe("account");
    });

    it("emits no filter flag at all when the list is empty", () => {
      // An empty --entitynamesfilter is not the same as omitting it; omit it.
      expect(buildModelBuilderArgs({ ...base, entityNamesFilter: [], messageNamesFilter: [] })).not.toContain("--entityNamesFilter");
      expect(buildModelBuilderArgs({ ...base })).not.toContain("--messageNamesFilter");
    });
  });

  describe("joinPacFilter", () => {
    it("trims and drops blanks, so a stray separator can't emit an empty name", () => {
      // Settings are entered/stored as CSV and split upstream; a trailing comma yields "".
      expect(joinPacFilter([" team ", "", "teamtemplate", "   "])).toBe("team;teamtemplate");
    });

    it("returns an empty string when nothing survives, so the caller omits the flag", () => {
      expect(joinPacFilter([])).toBe("");
      expect(joinPacFilter(["", "  "])).toBe("");
    });
  });

  describe("the remaining flags", () => {
    it("includes folder overrides only when set", () => {
      const args = buildModelBuilderArgs({ ...base, entityTypesFolder: "Entities", messagesTypesFolder: "Messages", optionSetsTypesFolder: "OptionSets" });
      expect(valueOf(args, "--entityTypesFolder")).toBe("Entities");
      expect(valueOf(args, "--messagesTypesFolder")).toBe("Messages");
      expect(valueOf(args, "--optionSetsTypesFolder")).toBe("OptionSets");
      expect(buildModelBuilderArgs(base)).not.toContain("--entityTypesFolder");
    });

    it("emits each boolean switch as a bare flag when true, and not at all when false", () => {
      const on = buildModelBuilderArgs({
        ...base,
        emitEntityEtc: true,
        emitFieldsClasses: true,
        emitVirtualAttributes: true,
        generateGlobalOptionSets: true,
        generateSdkMessages: true,
        suppressGeneratedCodeAttribute: true,
        suppressINotifyPattern: true,
      });
      for (const flag of [
        "--emitEntityETC",
        "--emitFieldsClasses",
        "--emitVirtualAttributes",
        "--generateGlobalOptionSets",
        "--generateSdkMessages",
        "--suppressGeneratedCodeAttribute",
        "--suppressINotifyPattern",
      ]) {
        expect(on, flag).toContain(flag);
      }
      const off = buildModelBuilderArgs({ ...base, emitEntityEtc: false, generateSdkMessages: false });
      expect(off).not.toContain("--emitEntityETC");
      expect(off).not.toContain("--generateSdkMessages");
    });

    it("passes the log level through", () => {
      expect(valueOf(buildModelBuilderArgs({ ...base, logLevel: "Trace" }), "--logLevel")).toBe("Trace");
    });
  });
});
