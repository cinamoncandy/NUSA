/**
 * Pure, Electron-free builders and a formatter for structured main-process startup and
 * renderer-health diagnostics. No Electron import here -- main.ts wires the actual
 * webContents event listeners and passes the captured event fields into these builders,
 * so the redaction/formatting rules stay testable without a BrowserWindow.
 */

export type DesktopStartupDiagnosticKind =
  | "RENDERER_LOAD_FAILED"
  | "RENDERER_PROCESS_GONE"
  | "PRELOAD_ERROR"
  | "RENDERER_CONSOLE_ERROR"
  | "RENDERER_UNRESPONSIVE"
  | "RENDERER_RESPONSIVE"
  | "RENDERER_LOAD_FINISHED"
  | "RENDERER_NAVIGATION_BLOCKED";

export interface DesktopStartupDiagnostic {
  readonly kind: DesktopStartupDiagnosticKind;
  readonly timestamp: number;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}

const LOG_PREFIX = "[NUSA_DESKTOP]";

/**
 * http/https URLs are stripped to origin + path (query/fragment may carry tokens or
 * session identifiers). file:// and other local schemes are kept exactly as given --
 * pinpointing which local asset path failed to resolve is the entire point of
 * RENDERER_LOAD_FAILED (see the WO-0003 apps/desktop/apps/desktop duplication bug).
 */
function sanitizeUrl(url: string): string {
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "[unparsable-url]";
  }
}

/** Never stores a raw Error object or a full stack -- first line only, length-bounded. */
function sanitizeMessage(message: string, maximumLength = 500): string {
  const firstLine = message.split("\n")[0] ?? "";
  return firstLine.length > maximumLength ? `${firstLine.slice(0, maximumLength)}…` : firstLine;
}

export function formatDesktopStartupDiagnostic(diagnostic: DesktopStartupDiagnostic): string {
  return `${LOG_PREFIX} ${JSON.stringify({
    kind: diagnostic.kind,
    timestamp: diagnostic.timestamp,
    message: diagnostic.message,
    ...(diagnostic.details ? { details: diagnostic.details } : {})
  })}`;
}

export interface RendererLoadFailedInput {
  readonly errorCode: number;
  readonly errorDescription: string;
  readonly validatedUrl: string;
  readonly isMainFrame: boolean;
}

export interface RendererNavigationBlockedInput {
  readonly reason: string;
  readonly url: string;
}

/**
 * A blocked top-level navigation, window-open, or webview attachment. Recorded because the
 * app never attempts any of these itself, so one happening is either a defect or an attempt to
 * reach the preload bridge from content the renderer was steered to.
 */
export function createRendererNavigationBlockedDiagnostic(input: RendererNavigationBlockedInput, now: number = Date.now()): DesktopStartupDiagnostic {
  const reason = sanitizeMessage(input.reason, 40);
  return {
    kind: "RENDERER_NAVIGATION_BLOCKED",
    timestamp: now,
    message: `Blocked renderer navigation (${reason})`,
    details: { reason, url: sanitizeUrl(sanitizeMessage(input.url, 200)) }
  };
}

export function createRendererLoadFailedDiagnostic(input: RendererLoadFailedInput, now: number = Date.now()): DesktopStartupDiagnostic {
  const description = sanitizeMessage(input.errorDescription);
  return {
    kind: "RENDERER_LOAD_FAILED",
    timestamp: now,
    message: `Renderer failed to load (${input.isMainFrame ? "main frame" : "subframe"}): ${description}`,
    details: {
      errorCode: input.errorCode,
      errorDescription: description,
      validatedUrl: sanitizeUrl(input.validatedUrl),
      isMainFrame: input.isMainFrame
    }
  };
}

export interface RendererProcessGoneInput {
  readonly reason: string;
  readonly exitCode: number;
}

export function createRendererProcessGoneDiagnostic(input: RendererProcessGoneInput, now: number = Date.now()): DesktopStartupDiagnostic {
  return {
    kind: "RENDERER_PROCESS_GONE",
    timestamp: now,
    message: `Renderer process gone: ${input.reason}`,
    details: { reason: input.reason, exitCode: input.exitCode }
  };
}

export interface PreloadErrorInput {
  readonly preloadPath: string;
  readonly errorMessage: string;
}

export function createPreloadErrorDiagnostic(input: PreloadErrorInput, now: number = Date.now()): DesktopStartupDiagnostic {
  const message = sanitizeMessage(input.errorMessage);
  return {
    kind: "PRELOAD_ERROR",
    timestamp: now,
    message: `Preload script threw: ${message}`,
    details: { preloadPath: sanitizeUrl(input.preloadPath), errorMessage: message }
  };
}

export interface RendererConsoleErrorInput {
  readonly message: string;
  readonly line: number;
  readonly sourceId: string;
}

export function createRendererConsoleErrorDiagnostic(input: RendererConsoleErrorInput, now: number = Date.now()): DesktopStartupDiagnostic {
  const message = sanitizeMessage(input.message);
  return {
    kind: "RENDERER_CONSOLE_ERROR",
    timestamp: now,
    message: `Renderer console error: ${message}`,
    details: { errorMessage: message, line: input.line, sourceId: sanitizeUrl(input.sourceId) }
  };
}

export function createRendererUnresponsiveDiagnostic(now: number = Date.now()): DesktopStartupDiagnostic {
  return { kind: "RENDERER_UNRESPONSIVE", timestamp: now, message: "Renderer became unresponsive" };
}

export function createRendererResponsiveDiagnostic(now: number = Date.now()): DesktopStartupDiagnostic {
  return { kind: "RENDERER_RESPONSIVE", timestamp: now, message: "Renderer became responsive again" };
}

export function createRendererLoadFinishedDiagnostic(now: number = Date.now()): DesktopStartupDiagnostic {
  return { kind: "RENDERER_LOAD_FINISHED", timestamp: now, message: "Renderer finished loading" };
}
