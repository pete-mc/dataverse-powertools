import { vi } from "vitest";

// Shared helpers for unit-testing the Dataverse HTTP fetchers (src/general/dataverse/*).
// The fetchers are pure (no vscode) but call node-fetch and read context.dataverse +
// context.channel — so a spec mocks node-fetch and passes one of these fake contexts.

export interface FakeContextOptions {
  organizationUrl?: string;
  authorizationToken?: string;
  isValid?: boolean;
  /** Token returned by getAuthorizationToken(); defaults to authorizationToken. */
  token?: string;
}

/** A minimal fake DataversePowerToolsContext with a captured output channel. */
export function fakeDataverseContext(opts: FakeContextOptions = {}) {
  const lines: string[] = [];
  const organizationUrl = opts.organizationUrl ?? "https://org.crm.dynamics.com";
  const authorizationToken = opts.authorizationToken ?? "tok";
  const context = {
    dataverse: {
      organizationUrl,
      authorizationToken,
      isValid: opts.isValid ?? true,
      initialize: vi.fn(async () => true),
      getAuthorizationToken: vi.fn(async () => opts.token ?? authorizationToken),
    },
    channel: {
      appendLine: (m: string) => lines.push(String(m)),
      show: () => undefined,
    },
  };
  return { context: context as any, lines };
}

/** A fake node-fetch Response for a successful JSON body. */
export function okJson(body: unknown) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body, text: async () => JSON.stringify(body) };
}

/** A fake node-fetch Response for a failed HTTP call. */
export function httpError(status: number, statusText = "", body = "") {
  return { ok: false, status, statusText, json: async () => null, text: async () => body };
}
