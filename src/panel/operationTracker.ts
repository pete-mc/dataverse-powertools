import DataversePowerToolsContext from "../context";
import { classifyOperationOutput, OperationStatus } from "./operationOutcome";

// Recent-operation feed for the actions panel (#100 v2). Long-running commands
// are wrapped in runTracked at their registration site; the panel renders the
// last few with live status. In-memory and session-scoped by design.
//
// A command that THROWS is recorded as failed. A command that handles its own
// failure — logs it and resolves, which most of them do — used to be recorded as
// "completed"; it is now judged from the lines it wrote to the output channel
// (#229). That decision lives in operationOutcome.ts.

export type { OperationStatus };

export interface OperationRecord {
  id: number;
  label: string;
  status: OperationStatus;
  startedAt: number;
  finishedAt?: number;
  detail?: string;
  /** Root of the component the operation ran against; undefined = workspace root (#47). */
  componentRoot?: string;
}

const MAX_RECORDS = 5;
let records: OperationRecord[] = [];
let sequence = 0;

export function getRecentOperations(): OperationRecord[] {
  return records.map((r) => ({ ...r }));
}

/** Test/reload hook — clears the feed. */
export function resetOperations(): void {
  records = [];
}

export async function runTracked<T>(context: DataversePowerToolsContext, label: string, run: () => Promise<T> | T): Promise<T> {
  const record: OperationRecord = { id: ++sequence, label, status: "running", startedAt: Date.now(), componentRoot: context.activeComponent?.root };
  records = [record, ...records].slice(0, MAX_RECORDS);
  context.refreshPanel?.();
  // Collect what the command reports while it runs: a resolved command may still have failed, and the
  // channel is where it said so (#229). Scoped to this operation and disposed in `finally`.
  const reported: string[] = [];
  const tap = context.onChannelLine?.((line) => {
    reported.push(line);
  });
  try {
    const result = await run();
    const outcome = classifyOperationOutput(reported);
    record.status = outcome.status;
    record.detail = outcome.detail;
    return result;
  } catch (err) {
    record.status = "error";
    record.detail = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    tap?.dispose();
    record.finishedAt = Date.now();
    context.refreshPanel?.();
  }
}
