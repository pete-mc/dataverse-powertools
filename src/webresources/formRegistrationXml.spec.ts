import { describe, it, expect } from "vitest";
import { applyFormRegistrations, ResolvedRegistration } from "./formRegistrationXml";

/* eslint-disable @typescript-eslint/naming-convention -- Dataverse form-XML attribute keys */

// A deterministic guid source so libraryUniqueId is assertable.
function guids(): () => string {
  let n = 0;
  return () => `guid-${++n}`;
}

const reg = (over: Partial<ResolvedRegistration> = {}): ResolvedRegistration => ({
  event: "onload",
  function: "pre.Account.OnLoad",
  libraryName: "pre_library.js",
  triggerId: "t1",
  ...over,
});

describe("applyFormRegistrations", () => {
  it("scaffolds formLibraries + events on an empty form with all required handler attributes", () => {
    const form: any = {};
    applyFormRegistrations(form, [reg()], new Set(["pre_library.js"]), guids());

    expect(form.formLibraries.Library).toEqual([{ "@_name": "pre_library.js", "@_libraryUniqueId": "{guid-1}" }]);
    const event = form.events.event[0];
    expect(event["@_name"]).toBe("onload");
    expect(event["@_active"]).toBe("true");
    const handler = event.Handlers.Handler[0];
    // The bug (0x80048425) was a nameless library — assert the name is always present.
    expect(handler["@_libraryName"]).toBe("pre_library.js");
    expect(handler["@_functionName"]).toBe("pre.Account.OnLoad");
    expect(handler["@_handlerUniqueId"]).toBe("{t1}");
    expect(handler["@_enabled"]).toBe("true");
    expect(handler["@_parameters"]).toBe("");
    expect(handler["@_passExecutionContext"]).toBe("false");
  });

  it("throws on a registration with no library name (the 0x80048425 shape) — writes nothing", () => {
    const form: any = {};
    expect(() => applyFormRegistrations(form, [reg({ libraryName: "" })], new Set(), guids())).toThrow(/0x80048425/);
    expect(form.formLibraries).toBeUndefined();
  });

  it("does not duplicate an already-present <Library>", () => {
    const form: any = { formLibraries: { Library: [{ "@_name": "pre_library.js", "@_libraryUniqueId": "{existing}" }] } };
    applyFormRegistrations(form, [reg()], new Set(["pre_library.js"]), guids());
    expect(form.formLibraries.Library).toHaveLength(1);
    expect(form.formLibraries.Library[0]["@_libraryUniqueId"]).toBe("{existing}");
  });

  it("emits one <Library> per distinct library (per-file output mode)", () => {
    const form: any = {};
    const regs = [reg({ function: "pre.A.OnLoad", libraryName: "pre_A.js", triggerId: "a" }), reg({ function: "pre.B.OnLoad", libraryName: "pre_B.js", triggerId: "b" })];
    applyFormRegistrations(form, regs, new Set(["pre_A.js", "pre_B.js"]), guids());
    expect(form.formLibraries.Library.map((l: any) => l["@_name"])).toEqual(["pre_A.js", "pre_B.js"]);
  });

  it("appends a new handler to an existing event and carries parameters + passExecutionContext", () => {
    const form: any = {
      events: { event: [{ "@_name": "onload", Handlers: { Handler: [{ "@_handlerUniqueId": "{other}", "@_libraryName": "someone_else.js", "@_functionName": "x" }] } }] },
    };
    applyFormRegistrations(form, [reg({ parameters: "a,b", executionContext: true })], new Set(["pre_library.js"]), guids());
    const handlers = form.events.event[0].Handlers.Handler;
    expect(handlers).toHaveLength(2);
    const added = handlers.find((h: any) => h["@_handlerUniqueId"] === "{t1}");
    expect(added["@_parameters"]).toBe("a,b");
    expect(added["@_passExecutionContext"]).toBe("true");
  });

  it("updates an existing handler in place (same handlerUniqueId)", () => {
    const form: any = {
      events: {
        event: [{ "@_name": "onload", Handlers: { Handler: [{ "@_handlerUniqueId": "{t1}", "@_functionName": "old.Fn", "@_libraryName": "pre_old.js", "@_parameters": "old" }] } }],
      },
    };
    applyFormRegistrations(form, [reg({ function: "new.Fn", libraryName: "pre_new.js" })], new Set(["pre_old.js", "pre_new.js"]), guids());
    const handlers = form.events.event[0].Handlers.Handler;
    expect(handlers).toHaveLength(1);
    expect(handlers[0]["@_functionName"]).toBe("new.Fn");
    expect(handlers[0]["@_libraryName"]).toBe("pre_new.js");
    expect(handlers[0]["@_parameters"]).toBe("");
  });

  it("prunes OUR stale handlers but leaves other solutions' handlers untouched", () => {
    const form: any = {
      events: {
        event: [
          {
            "@_name": "onload",
            Handlers: {
              Handler: [
                { "@_handlerUniqueId": "{stale}", "@_libraryName": "pre_library.js", "@_functionName": "gone" }, // ours, no longer decorated → removed
                { "@_handlerUniqueId": "{other}", "@_libraryName": "someone_else.js", "@_functionName": "keep" }, // not ours → kept
              ],
            },
          },
        ],
      },
    };
    applyFormRegistrations(form, [reg()], new Set(["pre_library.js"]), guids());
    const ids = form.events.event[0].Handlers.Handler.map((h: any) => h["@_handlerUniqueId"]).sort();
    expect(ids).toEqual(["{other}", "{t1}"]); // stale ours dropped, other kept, new added
  });

  it("removes events left with no handlers after pruning", () => {
    const form: any = {
      events: { event: [{ "@_name": "onsave", Handlers: { Handler: [{ "@_handlerUniqueId": "{stale}", "@_libraryName": "pre_library.js" }] } }] },
    };
    // A registration for a DIFFERENT event; the onsave event's only (owned, stale) handler is pruned → event removed.
    applyFormRegistrations(form, [reg({ event: "onload" })], new Set(["pre_library.js"]), guids());
    expect(form.events.event.map((e: any) => e["@_name"])).toEqual(["onload"]);
  });
});
