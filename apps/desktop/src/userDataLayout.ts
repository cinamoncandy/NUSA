import path from "node:path";

/**
 * The one place that decides where anything this app writes actually goes (WO-0034-A4O).
 *
 * Before this, each subsystem joined its own path onto `app.getPath("userData")`. That works
 * until two of them disagree about a name, and then a "missing" evidence archive is really an
 * archive written one directory over. Every writable location is now derived here, from one
 * root, so a rename is a single edit and a collision is impossible to introduce by accident.
 *
 * Development and production deliberately do NOT share a root. A developer running from
 * source and a user running the installed build would otherwise write into the same evidence
 * directory, and a half-finished experiment would show up as the user's incomplete archive --
 * blocking their next observation for a reason that has nothing to do with them.
 *
 * Nothing here stores credentials, and there is no path for them: the app has no
 * authenticated endpoint and no key to keep.
 */

export type NUSAEnvironment = "PRODUCTION" | "DEVELOPMENT";

export interface UserDataLayout {
  readonly environment: NUSAEnvironment;
  /** The single root everything below is derived from. */
  readonly root: string;
  readonly settingsFile: string;
  readonly firstRunFile: string;
  readonly logsDirectory: string;
  readonly evidenceDirectory: string;
  readonly recoveryDirectory: string;
  readonly crashDirectory: string;
  readonly diagnosticsDirectory: string;
  /**
   * The existing paper/control/database stores. In a packaged build `root` IS the userData
   * directory, so these resolve to exactly the paths pre-A4O builds used and no existing
   * install is migrated or orphaned. Only a development run gets somewhere else, which is
   * the entire point of separating the two.
   */
  readonly paperSessionFile: string;
  readonly controlSessionFile: string;
  readonly databaseFile: string;
  /** Legacy locations kept readable so an existing install is not orphaned. */
  readonly legacy: Readonly<{ evidenceDirectory: string; paperSessionFile: string; controlSessionFile: string; databaseFile: string }>;
}

/**
 * Suffix appended to the production root when running unpackaged.
 *
 * A suffix rather than a sibling directory: the OS already gave this app one place to write,
 * and inventing a second top-level location makes an uninstall miss it.
 */
export const DEVELOPMENT_ROOT_SUFFIX = "-dev";

export interface UserDataLayoutInput {
  /** Whatever `app.getPath("userData")` returned. Never guessed or reconstructed here. */
  readonly userDataPath: string;
  /** `app.isPackaged`. A packaged build is production; anything else is development. */
  readonly packaged: boolean;
}

export function resolveUserDataLayout(input: UserDataLayoutInput): UserDataLayout {
  if (typeof input.userDataPath !== "string" || input.userDataPath.trim().length === 0) {
    throw new Error("userData path is required to resolve the application data layout");
  }
  const environment: NUSAEnvironment = input.packaged ? "PRODUCTION" : "DEVELOPMENT";
  const base = path.normalize(input.userDataPath);
  const root = input.packaged ? base : `${base}${DEVELOPMENT_ROOT_SUFFIX}`;
  return Object.freeze({
    environment,
    root,
    settingsFile: path.join(root, "settings", "app-settings.json"),
    firstRunFile: path.join(root, "settings", "first-run.json"),
    logsDirectory: path.join(root, "logs"),
    evidenceDirectory: path.join(root, "shadow-evidence"),
    recoveryDirectory: path.join(root, "recovery"),
    crashDirectory: path.join(root, "crash"),
    diagnosticsDirectory: path.join(root, "diagnostics"),
    paperSessionFile: path.join(root, "paper-session.json"),
    controlSessionFile: path.join(root, "control-session.json"),
    databaseFile: path.join(root, "nusa.db"),
    // Pre-A4O installs wrote these directly under userData. They are still read from there so
    // an upgrade does not silently abandon a user's existing session and evidence.
    legacy: Object.freeze({
      evidenceDirectory: path.join(base, "shadow-evidence"),
      paperSessionFile: path.join(base, "paper-session.json"),
      controlSessionFile: path.join(base, "control-session.json"),
      databaseFile: path.join(base, "nusa.db")
    })
  });
}

/**
 * Directories that must exist before anything writes. Ordered outermost-first so a partial
 * failure leaves a prefix that exists rather than a scatter of unrelated leaves.
 */
export function writableDirectories(layout: UserDataLayout): readonly string[] {
  return Object.freeze([
    layout.root,
    path.dirname(layout.settingsFile),
    layout.logsDirectory,
    layout.evidenceDirectory,
    layout.recoveryDirectory,
    layout.crashDirectory,
    layout.diagnosticsDirectory
  ]);
}

/**
 * Locations a settings reset may delete, and the ones it may not (WO-0034-A4O req 7).
 *
 * Expressed as data rather than as branches inside the reset routine, so "does a reset touch
 * evidence" is answered by reading a list instead of by tracing control flow. The protected
 * list is what a test asserts against.
 */
export function resettablePaths(layout: UserDataLayout): readonly string[] {
  return Object.freeze([layout.settingsFile, layout.firstRunFile]);
}

export function protectedPaths(layout: UserDataLayout): readonly string[] {
  return Object.freeze([
    layout.evidenceDirectory,
    layout.recoveryDirectory,
    layout.crashDirectory,
    layout.legacy.evidenceDirectory
  ]);
}

/**
 * True when `candidate` is inside `parent`. Used to prove a delete target is not a protected
 * one, including via `..` -- a check on string prefixes alone would accept
 * `<root>/settings/../shadow-evidence`.
 */
export function isContainedIn(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
