import DataversePowerToolsContext from "../context";

// Recent-operation feed for the actions panel (#100 v2). Long-running commands
// are wrapped in runTracked at their registration site; the panel renders the
// last few with live status. In-memory and session-scoped by design.
//
// Honest limitation: many command implementations report failures via the
// output channel and resolve normally — those show as "completed". A thrown
// error is recorded as failed. Tightening this means having commands throw (or
// return a result) instead of swallowing errors; tracked in #100.

export type OperationStatus = "running" | "success" | "error";

export interface OperationRecord {
  id: number;
  label: string;
  status: OperationStatus;
  startedAt: number;
  finishedAt?: number;
  detail?: string;
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
  const record: OperationRecord = { id: ++sequence, label, status: "running", startedAt: Date.now() };
  records = [record, ...records].slice(0, MAX_RECORDS);
  context.refreshPanel?.();
  try {
    const result = await run();
    record.status = "success";
    return result;
  } catch (err) {
    record.status = "error";
    record.detail = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    record.finishedAt = Date.now();
    context.refreshPanel?.();
  }
}
