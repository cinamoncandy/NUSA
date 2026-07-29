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
  devTools: boolean; contextIsolation: true; nodeIntegration: false; sandbox: true; webSecurity: true;
}> {
  return Object.freeze({
    devTools: policy.devToolsEnabled,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true
  });
}
