// Pure builders for the Custom API metadata deploy (#142, issue #3). No `vscode`
// / no network — the Web API payloads and the create/update/delete reconcile are
// unit-tested here; deployCustomApi.ts does the actual HTTP. Option-set integer
// values and the immutable-after-save column list are per the official docs:
//   https://learn.microsoft.com/power-apps/developer/data-platform/custom-api-tables
//   https://learn.microsoft.com/power-apps/developer/data-platform/create-custom-api-solution

import { CustomApiDefinition, CustomApiBinding, AllowedCustomProcessingStepType, CustomApiParameterType, CustomApiRequestParameter, CustomApiResponseProperty } from "./definition";

// Keys below are the platform's PascalCase option-set labels, not identifiers.
/* eslint-disable @typescript-eslint/naming-convention */
/** CustomAPI.bindingtype option-set values. */
export const BINDING_TYPE: Record<CustomApiBinding, number> = { Global: 0, Entity: 1, EntityCollection: 2 };
/** CustomAPI.allowedcustomprocessingsteptype option-set values. */
export const PROCESSING_STEP_TYPE: Record<AllowedCustomProcessingStepType, number> = { None: 0, AsyncOnly: 1, SyncAndAsync: 2 };
/** customapifieldtype option-set values (request-parameter / response-property `type`). */
export const FIELD_TYPE: Record<CustomApiParameterType, number> = {
  Boolean: 0,
  DateTime: 1,
  Decimal: 2,
  Entity: 3,
  EntityCollection: 4,
  EntityReference: 5,
  Float: 6,
  Integer: 7,
  Money: 8,
  Picklist: 9,
  String: 10,
  StringArray: 11,
  Guid: 12,
};
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Body to CREATE the CustomAPI record. Includes the immutable-after-save columns
 * (bindingtype, isfunction, uniquename, …) which are only valid on create.
 * `description` is SystemRequired, so it falls back to the display name.
 */
export function buildCustomApiCreatePayload(def: CustomApiDefinition, pluginTypeId: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    uniquename: def.uniqueName,
    name: def.name,
    displayname: def.displayName,
    description: def.description || def.displayName,
    bindingtype: BINDING_TYPE[def.binding],
    isfunction: !!def.isFunction,
    isprivate: !!def.isPrivate,
    workflowsdkstepenabled: !!def.enabledForWorkflow,
    allowedcustomprocessingsteptype: PROCESSING_STEP_TYPE[def.allowedCustomProcessingStepType ?? "None"],
  };
  payload["PluginTypeId@odata.bind"] = `/plugintypes(${pluginTypeId})`;
  if (def.binding !== "Global" && def.boundEntityLogicalName) {
    payload.boundentitylogicalname = def.boundEntityLogicalName;
  }
  if (def.executePrivilegeName) {
    payload.executeprivilegename = def.executePrivilegeName;
  }
  return payload;
}

/**
 * Body to UPDATE (PATCH) an existing CustomAPI — MUTABLE columns only. The
 * immutable columns (bindingtype, isfunction, uniquename, boundentitylogicalname,
 * allowedcustomprocessingsteptype, workflowsdkstepenabled) are omitted so the
 * platform doesn't reject the update.
 */
export function buildCustomApiUpdatePayload(def: CustomApiDefinition, pluginTypeId: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: def.name,
    displayname: def.displayName,
    description: def.description || def.displayName,
    isprivate: !!def.isPrivate,
  };
  payload["PluginTypeId@odata.bind"] = `/plugintypes(${pluginTypeId})`;
  if (def.executePrivilegeName) {
    payload.executeprivilegename = def.executePrivilegeName;
  }
  return payload;
}

/** Body to CREATE a request parameter (bound to its CustomAPI). */
export function buildRequestParameterCreatePayload(param: CustomApiRequestParameter, customApiId: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    uniquename: param.uniqueName,
    name: param.name,
    displayname: param.displayName || param.uniqueName,
    description: param.description || param.displayName || param.uniqueName,
    type: FIELD_TYPE[param.type],
    isoptional: !!param.isOptional,
  };
  payload["CustomAPIId@odata.bind"] = `/customapis(${customApiId})`;
  return payload;
}

/** Body to CREATE a response property (bound to its CustomAPI). */
export function buildResponsePropertyCreatePayload(prop: CustomApiResponseProperty, customApiId: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    uniquename: prop.uniqueName,
    name: prop.name,
    displayname: prop.displayName || prop.uniqueName,
    description: prop.description || prop.displayName || prop.uniqueName,
    type: FIELD_TYPE[prop.type],
  };
  payload["CustomAPIId@odata.bind"] = `/customapis(${customApiId})`;
  return payload;
}

/** Body to UPDATE a request parameter or response property — mutable columns only
 * (type / uniquename / isoptional are immutable). */
export function buildMemberUpdatePayload(member: CustomApiRequestParameter | CustomApiResponseProperty): Record<string, unknown> {
  return {
    displayname: member.displayName || member.uniqueName,
    description: member.description || member.uniqueName,
  };
}

/** An existing child record as read back from Dataverse. */
export interface ExistingNamedRecord {
  id: string;
  uniquename: string;
}

/** The result of diffing desired members against what's live. */
export interface ReconcilePlan<T> {
  toCreate: T[];
  toUpdate: { desired: T; id: string }[];
  /** ids of records present in the env but absent from the definition — to delete. */
  toDelete: string[];
}

/**
 * Diff desired members (request params / response props) against the live records
 * by uniqueName (case-insensitive): new → create, matched → update, orphaned → delete.
 * This is the "reconcile deletes" behaviour — a param removed from the file is
 * removed in the environment.
 */
export function reconcileByUniqueName<T extends { uniqueName: string }>(desired: T[], existing: ExistingNamedRecord[]): ReconcilePlan<T> {
  const existingByName = new Map(existing.map((e) => [e.uniquename.toLowerCase(), e]));
  const desiredNames = new Set(desired.map((d) => d.uniqueName.toLowerCase()));

  const toCreate: T[] = [];
  const toUpdate: { desired: T; id: string }[] = [];
  const toDelete: string[] = [];

  for (const d of desired) {
    const match = existingByName.get(d.uniqueName.toLowerCase());
    if (match) {
      toUpdate.push({ desired: d, id: match.id });
    } else {
      toCreate.push(d);
    }
  }
  for (const e of existing) {
    if (!desiredNames.has(e.uniquename.toLowerCase())) {
      toDelete.push(e.id);
    }
  }

  return { toCreate, toUpdate, toDelete };
}
