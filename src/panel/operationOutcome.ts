// How the activity feed decides whether a command that RESOLVED actually succeeded (#229).
//
// The feed used to render every resolved command as ✓, because most command implementations report a
// failure to the output channel and then return normally — only a thrown error was recorded as failed.
// A deploy whose build died therefore showed as "completed", which is worse than showing nothing: this
// repo has already shipped a silent false success of exactly that shape (#129, `pac` exiting 0 on
// failure).
//
// Rather than rewrite two dozen commands to throw — which would change what the user sees when a
// command handles its own failure — the tracker now reads the evidence the command already produced:
// the lines it wrote to the output channel. This module is the whole decision, and it is pure.
//
// Two rules keep the signal table honest:
//   * commands SHOULD report through `context.reportFailure()` / `reportWarning()`, which emit the
//     canonical markers below — new code needs no new regex;
//   * the legacy signatures are narrow and each one is traceable to a real call site, because a false
//     "✗" on a successful operation is its own kind of lie.

export const FAILURE_MARKER = "[Failed]";
export const WARNING_MARKER = "[Warning]";

export type OperationStatus = "running" | "success" | "warning" | "error";

export interface OperationOutcome {
  status: "success" | "warning" | "error";
  /** The line that decided it, shown next to the label in the feed. */
  detail?: string;
}

/** The operation did not do its job. Each entry is a line a real command logs when it gives up. */
const ERROR_SIGNALS: RegExp[] = [
  /^\s*\[Failed\]\s*(?<detail>.+)$/, //                     canonical — context.reportFailure()
  /^(?<detail>Build failed\b.*)$/, //                       webpackBuild, buildProject
  /^(?<detail>Azure Function build failed\b.*)$/, //         buildAzureFunction
  /^(?<detail>.*\bdeployment skipped\b.*)$/i, //             buildAndDeploy: "Build failed; deployment skipped."
  /^(?<detail>Could not connect to dataverse\b.*)$/i, //     DataverseWebresource / DataverseForm
  /^(?<detail>Failed to publish customi[sz]ations?\b.*)$/i, // dataverseContext
  /^(?<detail>Error (?:building|publishing|running)\b.*)$/, // webpack/publish/custom-API run paths
  /^(?<detail>✗ .+)$/, //                                    custom API validation that blocks a deploy
];

/** The operation finished, but not everything it tried worked — a softer claim than ✓. */
const WARNING_SIGNALS: RegExp[] = [
  /^\s*\[Warning\]\s*(?<detail>.+)$/, //                    canonical — context.reportWarning()
  /^(?<detail>Warning: .+)$/, //                            saveFormData's malformed-decoration notice
  /^(?<detail>.*\bnon-fatal\b.*)$/i, //                     addComponent post-add onboarding
  /^(?<detail>Could not associate\b.*)$/i, //               registerPluginSteps / registerWorkflowActivities
  /^(?<detail>.*skipping solution association\b.*)$/i, //   DataverseWebresource
];

function firstMatch(lines: string[], signals: RegExp[]): string | undefined {
  for (const line of lines) {
    for (const signal of signals) {
      const match = signal.exec(line);
      if (match) {
        return (match.groups?.detail ?? line).trim();
      }
    }
  }
  return undefined;
}

/**
 * Classify a resolved operation from the output-channel lines it produced.
 *
 * An error signal anywhere wins over a warning: a command that failed and then also warned has
 * failed. With no signal at all the operation succeeded, which is the common case.
 */
export function classifyOperationOutput(lines: string[]): OperationOutcome {
  const failure = firstMatch(lines, ERROR_SIGNALS);
  if (failure !== undefined) {
    return { status: "error", detail: failure };
  }
  const warning = firstMatch(lines, WARNING_SIGNALS);
  if (warning !== undefined) {
    return { status: "warning", detail: warning };
  }
  return { status: "success" };
}
