import * as fs from "fs";
import * as path from "path";
import { E2EEnv, resetAllCredentials, runCommand, pickByLabel, answerText, answerFlexible, dismissOverlays, sleep, waitForOutput } from "./lib";
import { clickPanelButton, narrate } from "../supervised/supervisedLib";

// Shared harness for the button-driven component ACCEPTANCE e2e (user request): drive each
// component type's real main workflow (write code → build → register → publish) through the
// PANEL BUTTONS (not the command palette), then verify the outcome in Dataverse. Results are
// recorded to a JSON file so a component×step table can be built even from a partial run.

const resultsFile = path.resolve(__dirname, "..", "..", "..", "sandbox", "acceptance-results.json");

export type StepStatus = "pass" | "fail" | "blocked";
export interface StepResult {
  component: string;
  step: string;
  status: StepStatus;
  detail: string;
  at: string;
}

/** Append a step result to the shared JSON file (created on first write). */
export function record(component: string, step: string, status: StepStatus, detail: string): void {
  let all: StepResult[] = [];
  try {
    all = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
  } catch {
    /* first write */
  }
  all.push({ component, step, status, detail, at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
  fs.writeFileSync(resultsFile, JSON.stringify(all, null, 2));
  console.log(`    [acceptance] ${component} · ${step}: ${status.toUpperCase()} — ${detail}`);
}

/** Run a step, recording pass/fail (and rethrowing so mocha still marks the `it` red on failure). */
export async function step(component: string, name: string, run: () => Promise<string>): Promise<void> {
  try {
    const detail = await run();
    record(component, name, "pass", detail || "ok");
  } catch (error) {
    record(component, name, "fail", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** Initialise a SINGLE-TYPE project (the real "start a <type> project" flow) under SERVICE-
 * PRINCIPAL auth, driving the panel's own "Initialise Project" button + the connection wizard
 * (no command-palette shortcut). `typePrompts` answers the type-specific tail (project/package
 * names, template, create-class, …) that follows the shared connection steps. */
export async function initProject(typeLabel: string, env: E2EEnv, solutionFriendlyName: string, typePrompts: () => Promise<void>): Promise<void> {
  await resetAllCredentials((m) => console.log(`    [acceptance] ${m}`));
  await clickPanelButton("Initialise Project", { timeoutMs: 30000 });
  await narrate(`Wizard: new ${typeLabel} project, service-principal auth`);
  await pickByLabel(typeLabel);
  await pickByLabel("Service principal (client secret)");
  await answerText(env.tenantId);
  await answerText(env.clientId);
  await answerText(env.clientSecret);
  await answerFlexible(env.url);
  await pickByLabel(solutionFriendlyName);
  await typePrompts();
  await sleep(4000);
  await dismissOverlays();
}

/** Keep the output channel visible so progress/errors show; best-effort. */
export async function showLog(): Promise<void> {
  await runCommand("Dataverse PowerTools: Show Log").catch(() => undefined);
}

export { waitForOutput };
