// Pure builders for `pac pages` argument arrays (#74). No vscode import — keep
// the exact flags visible and unit-tested, like src/solution/pacArgs.ts.

export function pacPagesListArgs(): string[] {
  return ["pages", "list"];
}

export interface PagesDownloadOptions {
  websiteId: string;
  path: string;
  /** Power Pages data model: "Standard" | "Enhanced" (pac --modelVersion 1|2). */
  modelVersion?: 1 | 2;
  overwrite?: boolean;
}

export function pacPagesDownloadArgs(options: PagesDownloadOptions): string[] {
  const args = ["pages", "download", "--webSiteId", options.websiteId, "--path", options.path];
  if (options.modelVersion) {
    args.push("--modelVersion", String(options.modelVersion));
  }
  if (options.overwrite) {
    args.push("--overwrite");
  }
  return args;
}

export interface PagesUploadOptions {
  path: string;
  modelVersion?: 1 | 2;
}

export function pacPagesUploadArgs(options: PagesUploadOptions): string[] {
  const args = ["pages", "upload", "--path", options.path];
  if (options.modelVersion) {
    args.push("--modelVersion", String(options.modelVersion));
  }
  return args;
}
