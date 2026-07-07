// Minimal mock of the `vscode` API for Vitest unit tests.
//
// This is intentionally small: only stub what your tests actually exercise.
// When a unit test needs a `vscode` symbol that isn't here yet, add it rather
// than pulling in a heavyweight fake. For anything that genuinely depends on
// real editor behaviour (tree views, quick picks, the extension host), write
// an integration test under `src/test/suite` instead — do not try to simulate
// it here.
import { vi } from "vitest";

export const window = {
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showQuickPick: vi.fn(),
  showInputBox: vi.fn(),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    show: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  })),
  createStatusBarItem: vi.fn(() => ({
    text: "",
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  })),
  withProgress: vi.fn((_opts: unknown, task: (...args: unknown[]) => unknown) => task({ report: vi.fn() }, {})),
};

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
};

export const workspace = {
  getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
  workspaceFolders: [] as unknown[],
  fs: {},
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export enum ProgressLocation {
  Notification = 15,
  Window = 10,
}

export class Uri {
  private constructor(public readonly fsPath: string) {}
  static file(p: string): Uri {
    return new Uri(p);
  }
  static parse(p: string): Uri {
    return new Uri(p);
  }
}

export const EventEmitter = class<T> {
  event = vi.fn();
  fire = vi.fn<(data: T) => void>();
  dispose = vi.fn();
};

export default { window, commands, workspace, StatusBarAlignment, ProgressLocation, Uri, EventEmitter };
