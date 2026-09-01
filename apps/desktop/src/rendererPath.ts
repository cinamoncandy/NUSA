import path from "node:path";

/**
 * Resolve the canonical desktop renderer entry.
 *
 * UI/UX V2 intentionally uses a single renderer entry (`index-v2.html`) instead of
 * mounting the legacy renderer and hiding it behind another presentation layer. The
 * legacy `index.html` remains in the repository during migration as an immediate
 * rollback target, but it is no longer the active desktop entry point.
 *
 * No Electron import, app.getAppPath(), process.cwd(), or __dirname reference lives in
 * this helper; callers pass their compiled directory so the path remains deterministic
 * and unit-testable in development and packaged layouts.
 */
export function resolveRendererIndexPath(mainDirectory: string): string {
  return path.resolve(mainDirectory, "../../../../apps/desktop/renderer/index-v2.html");
}
