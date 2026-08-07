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
 * WO-0036 adds one credential path for encrypted read-only broker authentication. The file may
 * contain only OS-encrypted ciphertext and metadata. Raw keys, execution credentials, renderer
 * state, AI-visible state, logs, and evidence remain prohibited locations for secret material.
 */

export type NUSAEnvironment = "PRODUCTION" | "DEVELOPMENT";

export interface UserDataLayout {
  readonly environment: NUSAEnvironment;
  readonly root: string;
  readonly settingsFile: string;
  readonly firstRunFile: string;
  readonly logsDirectory: string;
  readonly evidenceDirectory: string;
  readonly recoveryDirectory: string;
  readonly crashDirectory: string;
  readonly diagnosticsDirectory: string;
  readonly readOnlyBrokerCredentialFile: string;
  readonly paperSessionFile: string;
  readonly controlSessionFile: string;
  readonly databaseFile: string;
  readonly legacy: Readonly<{ evidenceDirectory: string; paperSessionFile: string; controlSessionFile: string; databaseFile: string }>;
}

export const DEVELOPMENT_ROOT_SUFFIX = "-dev";

export interface UserDataLayoutInput {
  readonly userDataPath: string;
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
    readOnlyBrokerCredentialFile: path.join(root, "credentials", "upbit-read-only.enc"),
    paperSessionFile: path.join(root, "paper-session.json"),
    controlSessionFile: path.join(root, "control-session.json"),
    databaseFile: path.join(root, "nusa.db"),
    legacy: Object.freeze({
      evidenceDirectory: path.join(base, "shadow-evidence"),
      paperSessionFile: path.join(base, "paper-session.json"),
      controlSessionFile: path.join(base, "control-session.json"),
      databaseFile: path.join(base, "nusa.db")
    })
  });
}

export function writableDirectories(layout: UserDataLayout): readonly string[] {
  return Object.freeze([
    layout.root,
    path.dirname(layout.settingsFile),
    layout.logsDirectory,
    layout.evidenceDirectory,
    layout.recoveryDirectory,
    layout.crashDirectory,
    layout.diagnosticsDirectory,
    path.dirname(layout.readOnlyBrokerCredentialFile)
  ]);
}

export function resettablePaths(layout: UserDataLayout): readonly string[] {
  return Object.freeze([layout.settingsFile, layout.firstRunFile]);
}

export function protectedPaths(layout: UserDataLayout): readonly string[] {
  return Object.freeze([
    layout.evidenceDirectory,
    layout.recoveryDirectory,
    layout.crashDirectory,
    layout.readOnlyBrokerCredentialFile,
    layout.legacy.evidenceDirectory
  ]);
}

export function isContainedIn(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
