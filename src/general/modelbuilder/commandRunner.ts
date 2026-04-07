import * as cp from "child_process";

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

export async function resolvePacExecutable(): Promise<string> {
  if (process.platform !== "win32") {
    return "pac";
  }

  try {
    const { stdout } = await execFileAsync("where", ["pac"]);
    const firstMatch = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return firstMatch || "pac";
  } catch {
    return "pac";
  }
}
