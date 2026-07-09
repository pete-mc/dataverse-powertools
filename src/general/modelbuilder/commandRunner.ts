import * as cp from "child_process";
import { pacInvocation } from "../pac";

interface ExecResult {
  stdout: string;
  stderr: string;
}

export function execFileAsync(file: string, args: string[], cwd?: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    cp.execFile(file, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/** Run a `pac` command, capturing stdout/stderr. See pac.ts for the Windows .cmd handling. */
export async function runPac(args: string[], cwd?: string): Promise<ExecResult> {
  const { command, args: invocationArgs } = pacInvocation(args);
  return execFileAsync(command, invocationArgs, cwd);
}
