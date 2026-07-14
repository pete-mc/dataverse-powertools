// Pure form-XML mutation for form-event registration (#90), extracted from
// saveFormData so the library-dedup + handler upsert/prune logic — which once
// serialized a nameless <Library> and broke the whole form with 0x80048425 — is
// unit-testable without vscode or a live org. Operates on the fast-xml-parser
// JSON shape of a form's <form> element (attributes are "@_"-prefixed).

/* eslint-disable @typescript-eslint/naming-convention -- keys are Dataverse form-XML attribute names */

/** One handler to register, with its library name already resolved (upstream, from
 * the publisher prefix + output mode). */
export interface ResolvedRegistration {
  /** Event name, e.g. "onload" / "onsave". */
  event: string;
  /** Handler function, e.g. "prefix.Class.OnLoad". */
  function: string;
  /** Resolved web-resource library name (never empty — see the guard below). */
  libraryName: string;
  parameters?: string;
  executionContext?: boolean;
  /** Stable id that identifies this handler across runs (handlerUniqueId). */
  triggerId: string;
}

/**
 * Apply the resolved registrations to a form's `<form>` object IN PLACE (the shape
 * fast-xml-parser produces — `formRoot` is `form.form.form`):
 * - ensure one `<Library>` per distinct library the handlers bind to;
 * - upsert each handler (keyed by handlerUniqueId) under its event;
 * - drop OUR stale handlers (bound to an owned library, triggerId no longer
 *   decorated) — other solutions' handlers on the same form are untouched;
 * - prune events left with no handlers.
 *
 * `newGuid` supplies `libraryUniqueId` values (injected so tests are deterministic).
 * Throws if any registration lacks a library name — the exact 0x80048425 shape —
 * so a nameless `<Library>`/handler can never be written.
 */
export function applyFormRegistrations(formRoot: any, registrations: ResolvedRegistration[], ownedLibraries: Set<string>, newGuid: () => string): void {
  const nameless = registrations.find((registration) => !registration.libraryName);
  if (nameless) {
    throw new Error(
      `RegisterEvent for "${nameless.function || nameless.event}" has no resolved web-resource library name — refusing to write a form without a <Library> name (0x80048425).`,
    );
  }

  if (!formRoot.formLibraries) {
    formRoot.formLibraries = { Library: [] };
  }
  // One <Library> per distinct library the form's events bind to (per-file mode can
  // need several; bundle mode needs one).
  for (const neededLibrary of new Set(registrations.map((registration) => registration.libraryName))) {
    if (!formRoot.formLibraries.Library.find((library: any) => library["@_name"] === neededLibrary)) {
      formRoot.formLibraries.Library.push({
        "@_name": neededLibrary,
        "@_libraryUniqueId": "{" + newGuid() + "}",
      });
    }
  }

  for (const registration of registrations) {
    if (!formRoot.events) {
      formRoot.events = { event: [] };
    }
    const event = formRoot.events.event.find((candidate: any) => candidate["@_name"] === registration.event);
    if (!event) {
      formRoot.events.event.push({
        "@_name": registration.event,
        "@_active": "true",
        "@_application": "true",
        Handlers: {
          Handler: [
            {
              "@_enabled": "true",
              "@_functionName": registration.function,
              "@_libraryName": registration.libraryName,
              "@_parameters": registration.parameters ?? "",
              "@_passExecutionContext": registration.executionContext ? "true" : "false",
              "@_handlerUniqueId": "{" + registration.triggerId + "}",
            },
          ],
        },
      });
    } else {
      if (!event.Handlers) {
        event.Handlers = { Handler: [] };
      }
      const handler = event.Handlers.Handler.find((candidate: any) => candidate["@_handlerUniqueId"] === "{" + registration.triggerId + "}");
      if (!handler) {
        event.Handlers.Handler.push({
          "@_functionName": registration.function,
          "@_libraryName": registration.libraryName,
          "@_handlerUniqueId": "{" + registration.triggerId + "}",
          "@_enabled": "true",
          "@_parameters": registration.parameters ?? "",
          "@_passExecutionContext": registration.executionContext ? "true" : "false",
        });
      } else {
        handler["@_functionName"] = registration.function;
        handler["@_libraryName"] = registration.libraryName;
        handler["@_parameters"] = registration.parameters ?? "";
        handler["@_passExecutionContext"] = registration.executionContext ? "true" : "false";
      }
    }
  }

  // Remove any handlers bound to one of OUR library names (either output mode) whose
  // handlerUniqueId is no longer decorated — other solutions' handlers are untouchable.
  const liveHandlerIds = new Set(registrations.map((registration) => "{" + registration.triggerId + "}"));
  if (formRoot.events) {
    for (const event of formRoot.events.event) {
      if (event.Handlers) {
        event.Handlers.Handler = event.Handlers.Handler.filter((handler: any) => !ownedLibraries.has(handler["@_libraryName"]) || liveHandlerIds.has(handler["@_handlerUniqueId"]));
      }
    }
    // Remove any now-empty events.
    formRoot.events.event = formRoot.events.event.filter((event: any) => event.Handlers && event.Handlers.Handler.length > 0);
  }
}
