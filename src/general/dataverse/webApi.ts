// Single source of truth for the Dataverse Web API base URL + version, so call sites
// don't hand-build `${org}/api/data/v9.x/...` inconsistently (versions were mixed).

/** The Web API version the extension targets. */
export const DATAVERSE_API_VERSION = "v9.2";

const SLASH = "/".charCodeAt(0);

/** Remove trailing "/" characters. Non-regex (linear) to avoid backtracking on input. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === SLASH) {
    end--;
  }
  return value.slice(0, end);
}

/** Remove leading "/" characters. Non-regex (linear) to avoid backtracking on input. */
export function stripLeadingSlashes(value: string): string {
  let start = 0;
  while (start < value.length && value.charCodeAt(start) === SLASH) {
    start++;
  }
  return value.slice(start);
}

/**
 * Build a Dataverse Web API URL from the organization URL and a resource path, e.g.
 * dataverseApiUrl("https://org.crm.dynamics.com", "WhoAmI") ->
 * "https://org.crm.dynamics.com/api/data/v9.2/WhoAmI". Tolerates leading/trailing
 * slashes on either part.
 */
export function dataverseApiUrl(organizationUrl: string | undefined | null, resourcePath: string): string {
  const base = stripTrailingSlashes(organizationUrl ?? "");
  const resource = stripLeadingSlashes(resourcePath ?? "");
  return `${base}/api/data/${DATAVERSE_API_VERSION}/${resource}`;
}

/** Minimal output-channel surface the error helpers need (VS Code's OutputChannel satisfies it). */
export interface DataverseLogChannel {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
}

/** Minimal HTTP-response surface the error helpers need (node-fetch's Response satisfies it). */
export interface DataverseHttpResponse {
  status: number;
  statusText: string;
  text(): Promise<string>;
}

/**
 * Log a failed Dataverse HTTP response with consistent context — the operation that
 * was attempted, the status line, and the response body — then surface the output
 * channel. Returns the raw body so callers can inspect it (e.g. detect a specific
 * error signature) without reading the stream twice.
 */
export async function logDataverseHttpError(channel: DataverseLogChannel, operation: string, response: DataverseHttpResponse): Promise<string> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    /* ignore body read failure */
  }
  const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`.trim();
  channel.appendLine(`Failed to ${operation}: ${status}${body ? ` — ${body}` : ""}`);
  channel.show();
  return body;
}

/** Log a thrown error from a Dataverse operation with consistent context, then surface the channel. */
export function logDataverseError(channel: DataverseLogChannel, operation: string, error: unknown): void {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  channel.appendLine(`Error while trying to ${operation}: ${message}`);
  channel.show();
}
