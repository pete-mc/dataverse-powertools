// Pure C# codegen for a Custom API's typed plugin handler (#142, issue #2 — the
// differentiator). From one definition it emits a strongly-typed request wrapper
// (reads InputParameters as typed values), a response wrapper (writes
// OutputParameters), and the IPlugin class stub — so the handler reads
// `request.AccountId` instead of `(EntityReference)context.InputParameters["accountId"]`,
// and a definition change surfaces as a compiler error. No `vscode` import →
// unit-testable.

import { CustomApiDefinition, CustomApiParameterType, CustomApiRequestParameter, CustomApiResponseProperty } from "./definition";

/** Map a Custom API parameter type to the C# type the SDK surfaces it as.
 * Keys are the platform's PascalCase type vocabulary, not identifiers. */
/* eslint-disable @typescript-eslint/naming-convention */
const CSHARP_TYPES: Record<CustomApiParameterType, string> = {
  Boolean: "bool",
  DateTime: "System.DateTime",
  Decimal: "decimal",
  Entity: "Entity",
  EntityCollection: "EntityCollection",
  EntityReference: "EntityReference",
  Float: "double",
  Integer: "int",
  Money: "Money",
  Picklist: "OptionSetValue",
  String: "string",
  StringArray: "string[]",
  Guid: "System.Guid",
};
/* eslint-enable @typescript-eslint/naming-convention */

export function customApiParameterCSharpType(type: CustomApiParameterType): string {
  return CSHARP_TYPES[type];
}

/** Split a full type name into namespace + class (defaults the namespace when unqualified). */
export function splitPluginTypeName(fullTypeName: string): { namespaceName: string; className: string } {
  const trimmed = (fullTypeName || "").trim();
  const idx = trimmed.lastIndexOf(".");
  if (idx < 0) {
    return { namespaceName: "Dataverse.Plugins", className: trimmed || "CustomApiHandler" };
  }
  return { namespaceName: trimmed.slice(0, idx), className: trimmed.slice(idx + 1) };
}

function requestProperty(param: CustomApiRequestParameter): string {
  const csharpType = customApiParameterCSharpType(param.type);
  // Optional params may be absent from InputParameters; guard the read.
  return [
    param.description ? `        /// <summary>${escapeXml(param.description)}</summary>` : undefined,
    `        public ${csharpType} ${param.uniqueName} =>`,
    `            _context.InputParameters.Contains("${param.uniqueName}") ? (${csharpType})_context.InputParameters["${param.uniqueName}"] : default(${csharpType});`,
  ]
    .filter(Boolean)
    .join("\n");
}

function responseProperty(prop: CustomApiResponseProperty): string {
  const csharpType = customApiParameterCSharpType(prop.type);
  return [
    prop.description ? `        /// <summary>${escapeXml(prop.description)}</summary>` : undefined,
    `        public ${csharpType} ${prop.uniqueName}`,
    `        {`,
    `            set => _context.OutputParameters["${prop.uniqueName}"] = value;`,
    `        }`,
  ]
    .filter(Boolean)
    .join("\n");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Generate the full C# handler file (request wrapper + response wrapper + IPlugin
 * class) for a Custom API definition. The class name / namespace come from the
 * definition's pluginTypeName.
 */
export function generateCustomApiHandler(def: CustomApiDefinition): string {
  const { namespaceName, className } = splitPluginTypeName(def.pluginTypeName);
  const requestClass = `${className}Request`;
  const responseClass = `${className}Response`;

  const requestMembers = def.requestParameters.map(requestProperty).join("\n\n");
  const responseMembers = def.responseProperties.map(responseProperty).join("\n\n");

  return `using System;
using Microsoft.Xrm.Sdk;

namespace ${namespaceName}
{
    /// <summary>
    /// Typed request wrapper for the "${def.uniqueName}" Custom API — reads
    /// InputParameters as typed values. Generated from ${def.uniqueName}${".customapi.json"}; regenerate on change.
    /// </summary>
    public sealed class ${requestClass}
    {
        private readonly IPluginExecutionContext _context;
        public ${requestClass}(IPluginExecutionContext context) => _context = context;

${requestMembers || "        // (no request parameters defined)"}
    }

    /// <summary>
    /// Typed response wrapper for the "${def.uniqueName}" Custom API — writes OutputParameters.
    /// </summary>
    public sealed class ${responseClass}
    {
        private readonly IPluginExecutionContext _context;
        public ${responseClass}(IPluginExecutionContext context) => _context = context;

${responseMembers || "        // (no response properties defined)"}
    }

    /// <summary>
    /// Implements the "${def.uniqueName}" Custom API message.
    /// Registered as plugin type ${def.pluginTypeName}.
    /// </summary>
    public sealed class ${className} : IPlugin
    {
        public void Execute(IServiceProvider serviceProvider)
        {
            var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var request = new ${requestClass}(context);
            var response = new ${responseClass}(context);

            // TODO: implement the "${def.uniqueName}" operation.
            // Read typed inputs from 'request', set typed outputs on 'response'.
        }
    }
}
`;
}

/** Output file name for a definition's generated handler. */
export function customApiHandlerFileName(def: CustomApiDefinition): string {
  const { className } = splitPluginTypeName(def.pluginTypeName);
  return `${className}.generated.cs`;
}
