import DataversePowerToolsContext from "../context";

// In-flight pac operation state for the actions panel. The panel is network-free
// (computePanelState reads caches only), so a long-running pac command — and the
// device-code sign-in it may trigger — records its progress HERE and re-renders,
// giving the panel a persistent, obvious affordance instead of relying on a toast
// that auto-dismisses and an output channel that isn't open by default.
//
// Two layers:
//   - a pac OPERATION banner ("Generating early-bound classes…") for any long command;
//   - the device-code SIGN-IN sub-state (url + code), shown as a prominent card with
//     copy-code / open-page buttons while pac waits for the user to authenticate.
// Ending the operation clears both. Session-scoped, in-memory by design.

export interface DeviceCodeSignIn {
  /** The device-login page (e.g. https://microsoft.com/devicelogin). */
  url: string;
  /** The one-time code the user enters there (e.g. ABCD-EFGH). */
  code: string;
}

export interface PacOperation {
  /** Human label for the in-flight command, e.g. "Signing in to Power Platform CLI". */
  label: string;
}

let pacOperation: PacOperation | undefined;
let deviceCodeSignIn: DeviceCodeSignIn | undefined;

export function getPacOperation(): PacOperation | undefined {
  return pacOperation;
}

export function getDeviceCodeSignIn(): DeviceCodeSignIn | undefined {
  return deviceCodeSignIn;
}

/** Mark a long pac operation as started and re-render (shows the busy banner). */
export function beginPacOperation(context: DataversePowerToolsContext, label: string): void {
  pacOperation = { label };
  deviceCodeSignIn = undefined;
  context.refreshPanel?.();
}

/** Surface a pending device-code sign-in on the panel (prominent card) and re-render. */
export function setDeviceCodeSignIn(context: DataversePowerToolsContext, signin: DeviceCodeSignIn): void {
  deviceCodeSignIn = signin;
  context.refreshPanel?.();
}

/** Clear all in-flight pac state (operation done/failed) and re-render. */
export function endPacOperation(context: DataversePowerToolsContext): void {
  pacOperation = undefined;
  deviceCodeSignIn = undefined;
  context.refreshPanel?.();
}

/** Test/reload hook — clears state without a re-render. */
export function resetPacActivity(): void {
  pacOperation = undefined;
  deviceCodeSignIn = undefined;
}
