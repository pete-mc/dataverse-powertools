import { describe, it, expect, beforeEach, vi } from "vitest";
import { runTracked, getRecentOperations, resetOperations } from "./operationTracker";

// The actions-panel "recent operations" feed: a 5-record ring buffer with live
// status. vscode-free (imports only the context type), so unit-testable with a
// minimal fake context.

function fakeContext(root?: string): any {
  const listeners = new Set<(line: string) => void>();
  return {
    refreshPanel: vi.fn(),
    activeComponent: root ? { root } : undefined,
    onChannelLine: (listener: (line: string) => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    /** Stand-in for context.channel.appendLine — what the command under test reports while running. */
    log: (line: string) => listeners.forEach((l) => l(line)),
  };
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

  // #229: the case that used to render as ✓ — a command that reports its failure and resolves anyway.
  it("marks a SWALLOWED failure as error, from what the command reported", async () => {
    const context = fakeContext();
    await runTracked(context, "Deploy", () => {
      context.log("Building...");
      context.log("[Failed] Build failed: Command failed: npx webpack --config webpack.dev.js");
      return undefined; // resolves normally, exactly like the real deploy path
    });
    const [op] = getRecentOperations();
    expect(op.status).toBe("error");
    expect(op.detail).toBe("Build failed: Command failed: npx webpack --config webpack.dev.js");
  });

  it("marks a partial success as a warning", async () => {
    const context = fakeContext();
    await runTracked(context, "Build & deploy package", () => {
      context.log("Could not associate step 'Create account' with solution 'Dev'.");
    });
    expect(getRecentOperations()[0].status).toBe("warning");
  });

  it("still calls a quiet run a success", async () => {
    const context = fakeContext();
    await runTracked(context, "Build", () => {
      context.log("webpack compiled successfully");
      context.log("Building Complete");
    });
    expect(getRecentOperations()[0].status).toBe("success");
    expect(getRecentOperations()[0].detail).toBeUndefined();
  });

  it("stops listening when the operation ends, so a later failure is not blamed on it", async () => {
    const context = fakeContext();
    await runTracked(context, "Build", () => undefined);
    context.log("[Failed] something later went wrong");
    expect(getRecentOperations()[0].status).toBe("success");
  });

  it("works against a context with no channel tap (older/facade contexts)", async () => {
    const context = { refreshPanel: vi.fn() } as any;
    await runTracked(context, "Build", () => "ok");
    expect(getRecentOperations()[0].status).toBe("success");
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
