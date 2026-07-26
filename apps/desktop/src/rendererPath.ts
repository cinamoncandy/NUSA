import path from "node:path";

/**
 * Pure path arithmetic for the Electron renderer entry point. Takes the compiled main
 * process's own directory (dist/apps/desktop/src) and walks back up to the source tree's
 * apps/desktop/renderer/index.html -- the same walk holds for both `electron apps/desktop`
 * dev execution and electron-builder's packaged layout (files: dist/**, apps/desktop/**),
 * since both keep dist/ and apps/ as siblings under the app root. See WO-0003: this
 * previously duplicated the apps/desktop segment by combining app.getAppPath() (already
 * apps/desktop under dev execution) with another "apps/desktop/..." suffix.
 *
 * No Electron import, no app.getAppPath(), no process.cwd(), no __dirname reference --
 * callers pass their own directory in, so this stays testable without a GUI.
 */
export function resolveRendererIndexPath(mainDirectory: string): string {
  return path.resolve(mainDirectory, "../../../../apps/desktop/renderer/index.html");
}
