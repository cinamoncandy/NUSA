import type { LogLevel } from "./appSettingsStore";

/**
 * What a packaged build is and is not allowed to do (WO-0034-A4O req 10).
 *
 * Everything here is derived from ONE input, `packaged`. Not from NODE_ENV, not from a
 * `--dev` flag, not from the presence of a file: those can all be set by whoever is running
 * the app, and a hardening policy an attacker can turn off is decoration. `app.isPackaged` is
 * a property of the build itself.
 *
 * The three capability flags are literal `false` and not policy at all. They are restated
 * here so a reader of the production policy sees them in the same place as everything else,
 * and so a test can assert the packaged profile reports them.
 */

export interface ProductionPolicy {
  readonly packaged: boolean;
  /** DevTools may be opened. False in a packaged build, with no setting to re-enable it. */
  readonly devToolsEnabled: boolean;
  /** Development-only controls and mock data surfaces are rendered at all. */
  readonly developerUiVisible: boolean;
  readonly mockDataVisible: boolean;
  /** The most verbose level a packaged build will honour, whatever the user selects. */
  readonly maximumLogLevel: LogLevel;
  readonly verboseDebugLogging: boolean;
  /** Absolute paths may appear in renderer-visible text. */
  readonly exposeAbsolutePaths: boolean;
  /** Source maps are shipped inside the installer. */
  readonly shipSourceMaps: boolean;
  readonly liveTradingEnabled: false;
  readonly privateApiEnabled: false;
  readonly credentialStorageEnabled: false;
}

export function resolveProductionPolicy(packaged: boolean): ProductionPolicy {
  return Object.freeze({
    packaged,
    devToolsEnabled: !packaged,
    developerUiVisible: !packaged,
    mockDataVisible: !packaged,
    // A packaged build stops at INFO. DEBUG in a shipped app writes a stream of internal
    // detail to a user's disk that only helps someone who already has the source open.
    maximumLogLevel: packaged ? "INFO" : "DEBUG",
    verboseDebugLogging: !packaged,
    exposeAbsolutePaths: !packaged,
    // Source maps stay out of the installer: they are the source, and shipping them makes
    // "what does this app do internally" a question anyone with the .exe can answer fully.
    // They are kept next to the build output for the team instead.
    shipSourceMaps: false,
    liveTradingEnabled: false,
    privateApiEnabled: false,
    credentialStorageEnabled: false
  });
}

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = Object.freeze({ ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 });

/**
 * Clamps a user-selected log level to what the policy permits. A user asking for DEBUG in a
 * packaged build gets INFO rather than an error: the setting is a preference, and refusing it
 * outright would be a worse experience than quietly honouring as much of it as is allowed.
 */
export function clampLogLevel(requested: LogLevel, policy: ProductionPolicy): LogLevel {
  return LEVEL_RANK[requested] > LEVEL_RANK[policy.maximumLogLevel] ? policy.maximumLogLevel : requested;
}

/**
 * The BrowserWindow options this policy implies. Returned as data rather than applied here,
 * so the values can be asserted without constructing an Electron window.
 */
export function browserWindowSecurityOptions(policy: ProductionPolicy): Readonly<{
  devTools: boolean; contextIsolation: true; nodeIntegration: false; sandbox: true; webSecurity: true; webviewTag: false;
}> {
  return Object.freeze({
    devTools: policy.devToolsEnabled,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    // A <webview> would get its own webContents outside the navigation policy below.
    webviewTag: false
  });
}

/**
 * Whether the renderer may navigate itself to `target`.
 *
 * The preload bridge is re-injected on every navigation in a webContents, so a renderer that
 * reaches remote content hands that content `window.nusa`, `window.nusaApp` and the rest of
 * the bridge. The renderer's meta CSP does not survive such a navigation either, because the
 * new document carries the remote server's headers instead. The window is therefore pinned to
 * the local file it was loaded with: the app never navigates anywhere else on its own, so any
 * attempt to is either a defect or an attack.
 */
export function isAllowedRendererNavigation(currentUrl: string, target: string): boolean {
  let parsed: URL;
  try { parsed = new URL(target); } catch { return false; }
  if (parsed.protocol !== "file:") return false;
  let current: URL;
  try { current = new URL(currentUrl); } catch { return false; }
  if (current.protocol !== "file:") return false;
  // Compare the document path only. A reload or in-page fragment stays; a different file,
  // and anything carrying a query, does not.
  return parsed.pathname === current.pathname && parsed.search === "";
}

/** The minimal webContents surface the navigation policy needs, so it is testable without Electron. */
export interface NavigablewebContents {
  getURL(): string;
  on(event: "will-navigate", listener: (event: { preventDefault(): void }, url: string) => void): unknown;
  on(event: "will-attach-webview", listener: (event: { preventDefault(): void }) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): unknown;
}

/**
 * Pins a webContents to the document it already has: no top-level navigation away from it, no
 * new windows, no webview attachment. Applied to every webContents the app creates rather than
 * to one window, so a surface added later is covered by default instead of by remembering to.
 */
export function applyRendererNavigationPolicy(
  contents: NavigablewebContents,
  onBlocked: (reason: string, url: string) => void = () => {}
): void {
  contents.on("will-navigate", (event, url) => {
    if (isAllowedRendererNavigation(contents.getURL(), url)) return;
    event.preventDefault();
    onBlocked("WILL_NAVIGATE", url);
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
    onBlocked("WILL_ATTACH_WEBVIEW", "");
  });
  contents.setWindowOpenHandler((details) => {
    onBlocked("WINDOW_OPEN", details.url);
    return { action: "deny" };
  });
}
