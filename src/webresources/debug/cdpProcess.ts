import * as net from "net";
import * as cp from "child_process";
import CDP = require("chrome-remote-interface");

// Generic CDP + child-process plumbing shared by the web-resource (debugWebresources.ts) and
// PCF (debugPcfLiveForm.ts) hot-reload sessions. No feature specifics here — just: allocate a
// free debugging port, tree-kill a (possibly shell-wrapped) child, and connect CDP with retry.

/** Allocate a free localhost TCP port for the browser's remote-debugging endpoint. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("Could not allocate a debugging port."))));
    });
  });
}

/**
 * Kill a child process *and its descendants*. On Windows a shell-spawned process (webpack /
 * pcf-scripts run via a `.cmd` shim, so `shell: true`) makes `child.kill()` terminate only the
 * `cmd.exe` wrapper, orphaning the real `node --watch` — which then keeps rebuilding and holding
 * memory forever. `taskkill /T` walks the whole tree. Elsewhere the process isn't shell-wrapped,
 * so a plain kill suffices.
 */
export function killProcessTree(child: cp.ChildProcess | undefined): void {
  if (!child || child.pid === undefined) {
    return;
  }
  if (process.platform === "win32") {
    try {
      cp.execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch {
      /* fall through to a best-effort direct kill */
    }
  }
  try {
    child.kill();
  } catch {
    /* already gone */
  }
}

/** Connect CDP, retrying until the browser's debugging endpoint is up or the timeout elapses. */
export async function connectCdpWithRetry(port: number, timeoutMs: number): Promise<CDP.Client> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      return await CDP({ port });
    } catch (error) {
      lastError = error;
      if (Date.now() > deadline) {
        throw lastError instanceof Error ? lastError : new Error("Could not connect to the browser's debugging endpoint.");
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}
