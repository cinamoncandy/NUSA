import path from "node:path";

/** Resolve the single canonical desktop renderer entry. */
export function resolveRendererIndexPath(mainDirectory: string): string {
  return path.resolve(mainDirectory, "../../../../apps/desktop/renderer/index.html");
}
