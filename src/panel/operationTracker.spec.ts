import { describe, it, expect, beforeEach, vi } from "vitest";
import { runTracked, getRecentOperations, resetOperations } from "./operationTracker";

// The actions-panel "recent operations" feed: a 5-record ring buffer with live
// status. vscode-free (imports only the context type), so unit-testable with a
// minimal fake context.

function fakeContext(root?: string): any {
  return { refreshPanel: vi.fn(), activeComponent: root ? { root } : undefined };
}

describe("operationTracker", () => {
  beforeEach(() => resetOperations());

  it("records a running op then marks it success, returning the run's result", async () => {
    const context = fakeContext("/ws/plugin");
    const result = await runTracked(context, "Build", () => "done");
    expect(result).toBe("done");
    const [op] = getRecentOperations();
    expect(op.label).toBe("Build");
    expect(op.status).toBe("success");
    expect(op.finishedAt).toBeTypeOf("number");
    expect(op.componentRoot).toBe("/ws/plugin");
    // refreshPanel fires on start and on finish.
    expect(context.refreshPanel).toHaveBeenCalledTimes(2);
  });

  it("marks the op error and rethrows, capturing the message as detail", async () => {
    const context = fakeContext();
    await expect(runTracked(context, "Deploy", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    const [op] = getRecentOperations();
    expect(op.status).toBe("error");
    expect(op.detail).toBe("boom");
    expect(op.componentRoot).toBeUndefined();
  });

  it("keeps only the last 5 operations, newest first", async () => {
    const context = fakeContext();
    for (const label of ["a", "b", "c", "d", "e", "f"]) {
      await runTracked(context, label, () => undefined);
    }
    expect(getRecentOperations().map((op) => op.label)).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("assigns unique, increasing ids", async () => {
    const context = fakeContext();
    await runTracked(context, "one", () => undefined);
    await runTracked(context, "two", () => undefined);
    const ids = getRecentOperations().map((op) => op.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBeGreaterThan(ids[1]); // newest (higher id) first
  });

  it("getRecentOperations returns copies — mutating the result can't corrupt the feed", async () => {
    await runTracked(fakeContext(), "x", () => undefined);
    const snapshot = getRecentOperations();
    snapshot[0].label = "TAMPERED";
    expect(getRecentOperations()[0].label).toBe("x");
  });

  it("resetOperations clears the feed", async () => {
    await runTracked(fakeContext(), "x", () => undefined);
    resetOperations();
    expect(getRecentOperations()).toEqual([]);
  });
});
