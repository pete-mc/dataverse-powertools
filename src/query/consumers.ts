// What the FetchXML is being handed to, and what that consumer will accept (#238).
//
// Restricting the feature to FetchXML removes the need to TRANSLATE between query languages, but it
// does not remove the per-consumer differences — they just move from "can this be translated?" to
// "does this consumer accept this FetchXML?". A saved view rejects `aggregate`; a lookup filter
// takes a bare `<filter>` and silently ignores columns and joins; anything riding in a
// `?fetchXml=` query string has a URL length ceiling.
//
// Detection is a deliberate heuristic — the nearest known callee before the literal — not a parse.
// It degrades to `unknown` (generic checks only) rather than being wrong, and it costs nothing.
//
// Pure (no `vscode`) → unit-tested.

import { Language } from "./literals";

export interface Consumer {
  id: string;
  label: string;
  /** The root element this consumer expects. */
  expects: "fetch" | "filter";
  /** The query travels in a URL query string, so its length is bounded. */
  urlBound: boolean;
  /** This consumer rejects `aggregate="true"` outright. */
  rejectsAggregate: boolean;
  /** Source text that identifies this consumer, matched against the code before the literal. */
  markers: readonly string[];
  /** Languages this consumer can appear in. */
  languages: readonly Language[];
}

/** Practical ceiling for a FetchXML query riding in a GET query string, after URL encoding
 * roughly triples its length. Well under the ~8 KB total that servers and proxies enforce. */
export const URL_BOUND_XML_LIMIT = 2000;

export const UNKNOWN_CONSUMER: Consumer = {
  id: "unknown",
  label: "FetchXML",
  expects: "fetch",
  urlBound: false,
  rejectsAggregate: false,
  markers: [],
  languages: ["csharp", "typescript"],
};

export const CONSUMERS: readonly Consumer[] = [
  {
    id: "sdkFetchExpression",
    label: "FetchExpression (SDK)",
    expects: "fetch",
    urlBound: false,
    rejectsAggregate: false,
    markers: ["new FetchExpression(", "FetchExpression(", "RetrieveMultiple("],
    languages: ["csharp"],
  },
  {
    id: "savedQuery",
    label: "Saved view (savedquery / userquery)",
    expects: "fetch",
    urlBound: false,
    // A view's fetchxml cannot aggregate — the grid has nothing to bind aliased aggregates to.
    rejectsAggregate: true,
    markers: ['["fetchxml"]', '"fetchxml",', "savedquery", "userquery"],
    languages: ["csharp", "typescript"],
  },
  {
    label: "Xrm.WebApi / context.webAPI",
    id: "webApi",
    expects: "fetch",
    urlBound: true,
    rejectsAggregate: false,
    markers: ["retrieveMultipleRecords(", "?fetchXml=", "fetchXml="],
    languages: ["typescript"],
  },
  {
    id: "lookupFilter",
    label: "Lookup filter (addCustomFilter / lookupObjects)",
    expects: "filter",
    urlBound: false,
    // A `<filter>` fragment carries conditions only; an aggregate makes no sense there.
    rejectsAggregate: true,
    markers: ["addCustomFilter(", "lookupObjects(", "addPreSearch("],
    languages: ["typescript"],
  },
];

/** How far back to look for a callee. Generous enough for a wrapped argument list, small enough
 * that an unrelated call earlier in the method can't claim the query. */
const LOOKBEHIND = 300;

/** How far forward to look when the query was assigned to a variable before being used. */
const LOOKAHEAD = 600;

function nearestMarkerBehind(before: string, language: Language): Consumer | undefined {
  let best: Consumer | undefined;
  let bestIndex = -1;
  for (const consumer of CONSUMERS) {
    if (!consumer.languages.includes(language)) {
      continue;
    }
    for (const marker of consumer.markers) {
      const index = before.lastIndexOf(marker);
      if (index > bestIndex) {
        bestIndex = index;
        best = consumer;
      }
    }
  }
  return best;
}

function nearestMarkerAhead(after: string, language: Language): Consumer | undefined {
  let best: Consumer | undefined;
  let bestIndex = Number.MAX_SAFE_INTEGER;
  for (const consumer of CONSUMERS) {
    if (!consumer.languages.includes(language)) {
      continue;
    }
    for (const marker of consumer.markers) {
      const index = after.indexOf(marker);
      if (index !== -1 && index < bestIndex) {
        bestIndex = index;
        best = consumer;
      }
    }
  }
  return best;
}

/**
 * Identify the consumer from the code around the literal.
 *
 * Looking BEHIND handles the direct-argument case, `retrieveMultipleRecords(e, "?fetchXml=" + xml)`,
 * and the nearest marker wins so an earlier unrelated call can't claim the query. Looking AHEAD is
 * the fallback, because most real code assigns the query to a variable first and calls with it on
 * the next line — that shape is the common one, not the exception.
 *
 * Misattribution only costs a label and a diagnostic, never a code edit, so a heuristic is the right
 * trade here against parsing the file.
 */
export function detectConsumer(source: string, literalStart: number, literalEnd: number, language: Language): Consumer {
  const behind = nearestMarkerBehind(source.slice(Math.max(0, literalStart - LOOKBEHIND), literalStart), language);
  if (behind) {
    return behind;
  }
  return nearestMarkerAhead(source.slice(literalEnd, literalEnd + LOOKAHEAD), language) ?? UNKNOWN_CONSUMER;
}

export function consumerById(id: string): Consumer {
  return CONSUMERS.find((consumer) => consumer.id === id) ?? UNKNOWN_CONSUMER;
}
