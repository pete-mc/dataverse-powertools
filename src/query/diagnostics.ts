// FetchXML diagnostics (#238).
//
// These pay off with no generator involved at all: they are checks on code the user already wrote.
// The two that matter most are the ones nobody notices by reading:
//
//   * an unescaped value interpolated straight into an XML attribute — every codebase has these,
//     and they break on an apostrophe long before anyone calls it an injection;
//   * a local-time date compared against a Dataverse date column, which is always UTC, so the query
//     silently returns the wrong rows by however many hours the user's offset is.
//
// Pure (no `vscode`) → unit-tested. The VS Code layer maps these onto Diagnostic objects and, for
// the escaping one, a quick fix.

import { Consumer, URL_BOUND_XML_LIMIT } from "./consumers";
import { minifyFetchXml } from "./fetchXml";
import { Language } from "./literals";
import { MetadataLookup } from "./metadata/cache";
import { ParameterType, QueryParameter, inferParameterType } from "./parameters";
import { QueryNode, attrBool, walk } from "./queryModel";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface QueryDiagnostic {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  /** The code expression at fault, when the finding is about one — drives the quick fix. */
  expression?: string;
}

export interface DiagnoseOptions {
  root: QueryNode;
  consumer: Consumer;
  language: Language;
  parameters: readonly QueryParameter[];
  metadata?: MetadataLookup;
}

/** Helpers that make a value safe to interpolate. Wrapping in any of these clears the warning. */
const ESCAPE_HELPERS: Record<Language, readonly string[]> = {
  csharp: ["SecurityElement.Escape", "XmlConvert", "EscapeXml", "Escape(", "HtmlEncode", "XmlEscape"],
  typescript: ["escapeXml", "escapeXmlValue", "xmlEscape", "escapeFetchXmlValue"],
};

/** Expressions that produce a LOCAL time. Compared against a UTC column, they are quietly wrong. */
const LOCAL_TIME_PATTERNS = [/\bDateTime\.Now\b/, /\bDateTime\.Today\b/, /\bDateTimeOffset\.Now\b/];

/** Types that cannot carry an injection or a broken quote, so they need no escaping. */
const SAFE_TYPES: ReadonlySet<ParameterType> = new Set<ParameterType>(["guid", "number", "boolean", "datetime"]);

function isEscaped(expression: string, language: Language): boolean {
  return ESCAPE_HELPERS[language].some((helper) => expression.includes(helper));
}

export function diagnoseQuery(options: DiagnoseOptions): QueryDiagnostic[] {
  const { root, consumer, language, parameters, metadata } = options;
  const found: QueryDiagnostic[] = [];

  // --- consumer capability ------------------------------------------------------------------
  if (root.tag !== consumer.expects) {
    found.push({
      code: "wrongRoot",
      severity: "error",
      message:
        consumer.expects === "filter"
          ? `${consumer.label} takes a bare <filter> fragment, but this is a <${root.tag}>. Columns, orders, top and joins are ignored there.`
          : `${consumer.label} expects a <fetch> query, but this is a <${root.tag}>.`,
    });
  }

  const aggregate = attrBool(root, "aggregate");
  if (aggregate && consumer.rejectsAggregate) {
    found.push({ code: "aggregateRejected", severity: "error", message: `${consumer.label} does not accept an aggregate query.` });
  }

  if (consumer.urlBound && root.tag === "fetch") {
    const length = minifyFetchXml(root).length;
    if (length > URL_BOUND_XML_LIMIT) {
      found.push({
        code: "urlTooLong",
        severity: "warning",
        message: `This query is ${length} characters; ${consumer.label} sends it in a URL, where it will likely exceed the request-line limit once encoded. Trim columns or move the work server-side.`,
      });
    }
  }

  // --- parameters --------------------------------------------------------------------------
  for (const parameter of parameters) {
    if (parameter.expression === undefined) {
      continue;
    }
    const type = inferParameterType(parameter, metadata);
    if (!SAFE_TYPES.has(type) && !isEscaped(parameter.expression, language)) {
      found.push({
        code: "unescapedValue",
        severity: "warning",
        message: `\`${parameter.expression}\` is interpolated into an XML attribute without escaping. A value containing & or ' will break the query.`,
        expression: parameter.expression,
      });
    }
    if (type === "datetime" || parameter.usages.some((usage) => usage.operator && ["on", "on-or-before", "on-or-after"].includes(usage.operator))) {
      const local =
        language === "csharp"
          ? LOCAL_TIME_PATTERNS.some((pattern) => pattern.test(parameter.expression as string))
          : /new Date\(/.test(parameter.expression) && !/toISOString/.test(parameter.expression);
      if (local) {
        found.push({
          code: "localTime",
          severity: "warning",
          message: `\`${parameter.expression}\` is local time, but Dataverse compares dates in UTC — this returns the wrong rows by your UTC offset. Use ${
            language === "csharp" ? "DateTime.UtcNow" : ".toISOString()"
          }.`,
          expression: parameter.expression,
        });
      }
    }
  }

  // --- shape ------------------------------------------------------------------------------
  if (root.tag === "fetch") {
    if (root.attrs.top !== undefined && (root.attrs.page !== undefined || root.attrs.count !== undefined)) {
      found.push({ code: "topWithPaging", severity: "warning", message: "`top` cannot be combined with `page`/`count` — Dataverse rejects the query. Use one or the other." });
    }

    walk(root, (node, parents) => {
      if (node.tag === "attribute") {
        if (node.attrs.aggregate !== undefined && node.attrs.alias === undefined) {
          found.push({
            code: "aggregateNeedsAlias",
            severity: "error",
            message: `An aggregate attribute needs an alias (\`${node.attrs.aggregate}\` on \`${node.attrs.name ?? "?"}\`).`,
          });
        }
        if (aggregate && node.attrs.aggregate === undefined && !attrBool(node, "groupby")) {
          found.push({
            code: "aggregateNeedsGroupBy",
            severity: "warning",
            message: `In an aggregate query every attribute must aggregate or group — \`${node.attrs.name ?? "?"}\` does neither.`,
          });
        }
      }

      if (node.tag === "all-attributes") {
        found.push({ code: "allAttributes", severity: "info", message: "`<all-attributes />` returns every column on every row. Select only the columns you use." });
      }

      if (node.tag === "entity" || node.tag === "link-entity") {
        const entity = node.attrs.name;
        if (entity !== undefined && !entity.startsWith("@") && metadata?.knownEntity(entity) === false) {
          found.push({ code: "unknownEntity", severity: "warning", message: `No table \`${entity}\` in this environment.` });
        }
        const selectsNothing = !node.children.some((child) => child.tag === "attribute" || child.tag === "all-attributes");
        if (selectsNothing && node.tag === "entity" && !aggregate) {
          found.push({ code: "noColumns", severity: "info", message: "No <attribute> elements, so this returns only the primary key." });
        }
      }

      if (node.tag === "condition" || node.tag === "attribute" || node.tag === "order") {
        const attribute = node.attrs.attribute ?? node.attrs.name;
        const entity = node.attrs.entityname ?? nearestEntity(parents);
        if (attribute !== undefined && entity !== undefined && !attribute.startsWith("@") && metadata?.knownAttribute(entity, attribute) === false) {
          found.push({ code: "unknownAttribute", severity: "warning", message: `No column \`${attribute}\` on \`${entity}\`.` });
        }
      }
    });
  }

  return found;
}

function nearestEntity(parents: readonly QueryNode[]): string | undefined {
  for (let i = parents.length - 1; i >= 0; i--) {
    if (parents[i].tag === "entity" || parents[i].tag === "link-entity") {
      return parents[i].attrs.name;
    }
  }
  return undefined;
}
