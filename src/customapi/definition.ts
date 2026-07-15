// Custom API "definition-as-code" file format (#142, issue #1).
//
// PURE module — no `vscode` import — so the shape, defaults, validation
// (validate.ts) and codegen (generateHandler.ts) are all unit-testable without
// the editor. A `*.customapi.json` file on disk is the single source of truth a
// Custom API's typed handler (and, later, its metadata deploy / typed caller)
// derive from.
//
// Field names mirror the Dataverse CustomAPI / CustomAPIRequestParameter /
// CustomAPIResponseProperty tables so a future metadata deploy (#3, DEFERRED)
// maps 1:1. See:
//   https://learn.microsoft.com/power-apps/developer/data-platform/custom-api-tables

/** Dataverse Custom API binding type (CustomAPI.bindingtype). */
export type CustomApiBinding = "Global" | "Entity" | "EntityCollection";

/** Dataverse CustomAPI.allowedcustomprocessingsteptype — whether other plug-ins
 * may register extra steps against the message this Custom API creates. */
export type AllowedCustomProcessingStepType = "None" | "AsyncOnly" | "SyncAndAsync";

/**
 * The Custom API request-parameter / response-property type enum
 * (CustomAPIRequestParameter.type / CustomAPIResponseProperty.type). These are
 * the exact string values the platform accepts.
 */
export type CustomApiParameterType =
  "Boolean" | "DateTime" | "Decimal" | "Entity" | "EntityCollection" | "EntityReference" | "Float" | "Integer" | "Money" | "Picklist" | "String" | "StringArray" | "Guid";

/** All valid parameter-type values, for validation and quick-picks. */
export const CUSTOM_API_PARAMETER_TYPES: readonly CustomApiParameterType[] = [
  "Boolean",
  "DateTime",
  "Decimal",
  "Entity",
  "EntityCollection",
  "EntityReference",
  "Float",
  "Integer",
  "Money",
  "Picklist",
  "String",
  "StringArray",
  "Guid",
];

/** A single Custom API request parameter (an input to the message). */
export interface CustomApiRequestParameter {
  /** CustomAPIRequestParameter.uniquename — the key used in InputParameters. Immutable once deployed. */
  uniqueName: string;
  /** CustomAPIRequestParameter.name — primary name. Convention: `{apiUniqueName}.{uniqueName}`. */
  name: string;
  /** Localizable display name. */
  displayName?: string;
  /** Parameter data type. */
  type: CustomApiParameterType;
  /** Whether the caller may omit a value (CustomAPIRequestParameter.isoptional). */
  isOptional?: boolean;
  /** Localizable description. */
  description?: string;
}

/** A single Custom API response property (an output of the message). */
export interface CustomApiResponseProperty {
  /** CustomAPIResponseProperty.uniquename — the key used in OutputParameters. Immutable once deployed. */
  uniqueName: string;
  /** CustomAPIResponseProperty.name — primary name. Convention: `{apiUniqueName}.{uniqueName}`. */
  name: string;
  /** Localizable display name. */
  displayName?: string;
  /** Property data type. */
  type: CustomApiParameterType;
  /** Localizable description. */
  description?: string;
}

/**
 * The full Custom API definition — one `*.customapi.json` file.
 * Property names track the CustomAPI table columns.
 */
export interface CustomApiDefinition {
  /** CustomAPI.uniquename — the message name (e.g. `sample_DoTheThing`). Immutable once deployed. */
  uniqueName: string;
  /** CustomAPI.name — primary name of the record. */
  name: string;
  /** Localizable display name (CustomAPI.displayname). */
  displayName: string;
  /** Localizable description (CustomAPI.description). */
  description?: string;
  /** CustomAPI.bindingtype. */
  binding: CustomApiBinding;
  /** CustomAPI.boundentitylogicalname — required when binding != "Global". */
  boundEntityLogicalName?: string;
  /** CustomAPI.isfunction — true = OData Function (GET), false = Action (POST). Immutable once deployed. */
  isFunction: boolean;
  /** CustomAPI.isprivate — hide from $metadata / codegen. */
  isPrivate?: boolean;
  /** CustomAPI.workflowsdkstepenabled — usable as a workflow action. */
  enabledForWorkflow?: boolean;
  /** CustomAPI.allowedcustomprocessingsteptype. */
  allowedCustomProcessingStepType?: AllowedCustomProcessingStepType;
  /** CustomAPI.executeprivilegename — a privilege Name that gates execution. */
  executePrivilegeName?: string;
  /** The C# plugin class that implements the main operation (CustomAPI.PluginTypeId → plugintype.typename). */
  pluginTypeName: string;
  /** Inputs. */
  requestParameters: CustomApiRequestParameter[];
  /** Outputs. */
  responseProperties: CustomApiResponseProperty[];
}

/** File-name suffix that marks a Custom API definition file. */
export const CUSTOM_API_FILE_SUFFIX = ".customapi.json";

/**
 * Build a minimal, valid sample definition to seed a new `*.customapi.json`.
 * Global unbound Action with one example request param + one response property —
 * enough to generate a compiling handler immediately.
 */
export function newCustomApiDefinition(uniqueName: string, pluginTypeName: string): CustomApiDefinition {
  return {
    uniqueName,
    name: uniqueName,
    displayName: uniqueName,
    description: "",
    binding: "Global",
    isFunction: false,
    isPrivate: false,
    enabledForWorkflow: false,
    allowedCustomProcessingStepType: "None",
    pluginTypeName,
    requestParameters: [
      {
        uniqueName: "InputValue",
        name: `${uniqueName}.InputValue`,
        displayName: "Input Value",
        type: "String",
        isOptional: false,
        description: "Example request parameter.",
      },
    ],
    responseProperties: [
      {
        uniqueName: "OutputValue",
        name: `${uniqueName}.OutputValue`,
        displayName: "Output Value",
        type: "String",
        description: "Example response property.",
      },
    ],
  };
}
