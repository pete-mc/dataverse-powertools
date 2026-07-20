// Reusable in-memory Dataverse Web API mock for unit tests (#143 Move 2).
//
// The extension's Dataverse clients (src/general/dataverse/*) all call the global `fetch`
// with a Bearer token from `context.dataverse.getAuthorizationToken()`. This installs a fake
// `global.fetch` that models a handful of Dataverse Web API endpoints over configurable
// in-memory state, so command/handler logic — especially the OAuth-vs-service-principal
// branching that has bitten repeatedly (#128/#129/#135) — is testable in CI without a live
// org. It records every request (URL, method, Authorization) so tests can assert the auth
// path. No new dependency: it's a plain fetch shim, restored on teardown.

export type TraceLevel = 0 | 1 | 2;

/** A plugin assembly row as the profiler-prep path reads/writes it. `content` is base64 or null —
 *  null for a PACKAGE-deployed assembly, which capture temporarily populates (0.14.43). */
export interface MockPluginAssembly {
  pluginassemblyid: string;
  name: string;
  content: string | null;
  /** The `_packageid_value` lookup — set when the assembly was deployed as a package. */
  packageId?: string | null;
}

export interface DataverseMockState {
  /** The single `organization` row id + its plug-in trace level. */
  organizationId: string;
  pluginTraceLogSetting: TraceLevel;
  /** WhoAmI response fields. */
  userId: string;
  businessUnitId: string;
  /** Rows returned by GET plugintracelogs (the trace-log viewer, #63/#137). */
  pluginTraceLogs: Array<Record<string, unknown>>;
  /** Plugin assemblies for the profiler-prep path (getPluginAssemblyProfilingInfo / setPluginAssemblyContent). */
  pluginAssemblies: MockPluginAssembly[];
  /** Rows returned by GET sdkmessageprocessingsteps (profilable-steps + profiler-clone delete, #135/#139). */
  sdkMessageProcessingSteps: Array<Record<string, unknown>>;
  /** Rows returned by GET solutions (isProfilerInstalled). */
  solutions: Array<Record<string, unknown>>;
  /** Rows returned by GET mbs_pluginprofiles (captured profiles list + one report by id). */
  pluginProfiles: Array<Record<string, unknown>>;
  /** How many times ImportSolution was POSTed (the profiler-solution install path). */
  importSolutionCalls: number;
}

export interface RecordedRequest {
  url: string;
  method: string;
  /** The Authorization header, e.g. "Bearer <token>" — lets tests assert the token reached the API. */
  authorization?: string;
  body?: unknown;
}

export interface DataverseFetchMock {
  state: DataverseMockState;
  requests: RecordedRequest[];
  restore(): void;
}

export const DEFAULT_MOCK_STATE: DataverseMockState = {
  organizationId: "12345678-1234-1234-1234-1234567890ab",
  pluginTraceLogSetting: 0,
  userId: "aaaaaaaa-1111-2222-3333-444444444444",
  businessUnitId: "bbbbbbbb-5555-6666-7777-888888888888",
  pluginTraceLogs: [],
  pluginAssemblies: [],
  sdkMessageProcessingSteps: [],
  solutions: [],
  pluginProfiles: [],
  importSolutionCalls: 0,
};

/** The GUID inside a keyed resource segment, e.g. `pluginassemblies(<id>)` → `<id>`. */
function keyOf(resource: string): string {
  const open = resource.indexOf("(");
  const close = resource.indexOf(")");
  return open >= 0 && close > open ? resource.slice(open + 1, close) : "";
}

/** Extract a `name eq '…'` (OData, doubled single-quotes) filter value from a resource, if present. */
function nameFilterOf(resource: string): string | undefined {
  const match = /name eq '((?:[^']|'')*)'/.exec(decodeURIComponent(resource));
  return match ? match[1].replace(/''/g, "'") : undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Install the mock over `global.fetch`. Returns the mutable state, the recorded requests,
 * and a `restore()` to put the original fetch back (call it in afterEach).
 */
export function installDataverseFetchMock(initial: Partial<DataverseMockState> = {}): DataverseFetchMock {
  const state: DataverseMockState = { ...DEFAULT_MOCK_STATE, ...initial };
  const requests: RecordedRequest[] = [];
  const original = global.fetch;

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    let body: unknown;
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    requests.push({ url, method, authorization: headers.get("Authorization") ?? undefined, body });

    // Only the Dataverse Web API path is modelled; anything else 404s (a test hitting an
    // unmodelled endpoint should fail loudly rather than silently pass).
    const apiIndex = url.indexOf("/api/data/");
    if (apiIndex === -1) {
      return json({ error: { message: "not a Dataverse Web API url" } }, 404);
    }
    const resource = url.slice(url.indexOf("/", apiIndex + "/api/data/".length) + 1); // after the version segment

    // GET organizations?$select=… → the single org row.
    if (method === "GET" && resource.startsWith("organizations?")) {
      return json({ value: [{ organizationid: state.organizationId, plugintracelogsetting: state.pluginTraceLogSetting }] });
    }
    // PATCH organizations(<id>) → update the trace level (204 No Content).
    if (method === "PATCH" && resource.startsWith(`organizations(${state.organizationId})`)) {
      const patch = body as { plugintracelogsetting?: number } | undefined;
      if (patch && (patch.plugintracelogsetting === 0 || patch.plugintracelogsetting === 1 || patch.plugintracelogsetting === 2)) {
        state.pluginTraceLogSetting = patch.plugintracelogsetting;
      }
      return new Response(null, { status: 204 });
    }
    // GET plugintracelogs?$select=…&$orderby=…&$top=… → the trace-log rows.
    if (method === "GET" && resource.startsWith("plugintracelogs?")) {
      return json({ value: state.pluginTraceLogs });
    }
    // GET WhoAmI → identity (auth-agnostic; the token is what authorises).
    if (method === "GET" && resource.startsWith("WhoAmI")) {
      return json({ UserId: state.userId, BusinessUnitId: state.businessUnitId, OrganizationId: state.organizationId });
    }

    // --- Plugin Profiler surface (#63/#135/#139, 0.14.43) ---

    // GET solutions?…uniquename eq 'PluginProfiler' → whether the profiler solution is installed.
    if (method === "GET" && resource.startsWith("solutions?")) {
      return json({ value: state.solutions });
    }
    // GET pluginassemblies?…&$filter=name eq '<name>'&$top=1 → resolve one assembly for profiling prep.
    if (method === "GET" && resource.startsWith("pluginassemblies?")) {
      const name = nameFilterOf(resource);
      const rows = (name ? state.pluginAssemblies.filter((a) => a.name === name) : state.pluginAssemblies).slice(0, 1);
      return json({ value: rows.map((a) => ({ pluginassemblyid: a.pluginassemblyid, content: a.content, _packageid_value: a.packageId ?? null })) });
    }
    // PATCH pluginassemblies(<id>) → populate/clear content (0.14.43 package-assembly prep).
    if (method === "PATCH" && resource.startsWith("pluginassemblies(")) {
      const assembly = state.pluginAssemblies.find((a) => a.pluginassemblyid === keyOf(resource));
      if (!assembly) {
        return json({ error: { message: "no such pluginassembly" } }, 404);
      }
      const patch = body as { content?: string } | undefined;
      if (patch && typeof patch.content === "string") {
        assembly.content = patch.content.length > 0 ? patch.content : null;
      }
      return new Response(null, { status: 204 });
    }
    // DELETE sdkmessageprocessingsteps(<id>) → remove a profiler clone step (org-safety cleanup). Idempotent.
    if (method === "DELETE" && resource.startsWith("sdkmessageprocessingsteps(")) {
      const id = keyOf(resource);
      state.sdkMessageProcessingSteps = state.sdkMessageProcessingSteps.filter((s) => s.sdkmessageprocessingstepid !== id);
      return new Response(null, { status: 204 });
    }
    // GET sdkmessageprocessingsteps?… → profilable steps + active (Profiled) clones.
    if (method === "GET" && resource.startsWith("sdkmessageprocessingsteps?")) {
      return json({ value: state.sdkMessageProcessingSteps });
    }
    // GET mbs_pluginprofiles(<id>)?$select=mbs_profile → one captured profile's report.
    if (method === "GET" && resource.startsWith("mbs_pluginprofiles(")) {
      const row = state.pluginProfiles.find((p) => p.mbs_pluginprofileid === keyOf(resource));
      return row ? json({ mbs_profile: row.mbs_profile }) : json({ error: { message: "no such profile" } }, 404);
    }
    // GET mbs_pluginprofiles?… → captured profiles, newest first (list).
    if (method === "GET" && resource.startsWith("mbs_pluginprofiles?")) {
      return json({ value: state.pluginProfiles });
    }
    // POST ImportSolution → install the profiler managed solution (synchronous, 204).
    if (method === "POST" && resource.startsWith("ImportSolution")) {
      state.importSolutionCalls++;
      return new Response(null, { status: 204 });
    }

    return json({ error: { message: `unmodelled ${method} ${resource}` } }, 404);
  }) as typeof fetch;

  return { state, requests, restore: () => void (global.fetch = original) };
}
