import type { DokkaebiOperatingMode } from "./firstRunNotice";
import type { UserDataLayout } from "./userDataLayout";

/**
 * What the About screen may say (WO-0034-A4O req 2).
 *
 * The rule this file exists to enforce: the About screen names LOCATIONS the user can open,
 * but never prints an absolute path into the UI text. A screenshot of an About box ends up in
 * a support thread, a bug report, or a forum post, and an absolute path carries the account
 * name of whoever took it. `openLogsFolder()` gets the user to the same place without
 * publishing where it is.
 *
 * `liveTradingDisabled` and its two companions are literal `true` constants, not computed
 * flags. There is no code path in this application that can produce `false` for them, and a
 * field that could would be a claim about a capability rather than a statement of its
 * absence.
 */

export interface AboutFolder {
  readonly key: "LOGS" | "EVIDENCE" | "USER_DATA";
  readonly label: string;
  /** For the main process to open. Never rendered as text by the About screen. */
  readonly absolutePath: string;
}

export interface AboutInfo {
  readonly appName: string;
  readonly appVersion: string;
  /** Build identity when the packager provided one, otherwise null. Never invented. */
  readonly buildNumber: string | null;
  readonly commitSha: string | null;
  readonly electronVersion: string | null;
  readonly nodeVersion: string;
  readonly chromeVersion: string | null;
  readonly operatingSystem: string;
  readonly architecture: string;
  readonly environment: string;
  readonly mode: DokkaebiOperatingMode;
  readonly liveTradingDisabled: true;
  readonly privateApiDisabled: true;
  readonly credentialStorageDisabled: true;
  readonly copyright: string;
  readonly license: string;
  readonly folders: readonly AboutFolder[];
}

export interface AboutInfoInput {
  readonly appName: string;
  readonly appVersion: string;
  readonly buildNumber?: string | null;
  readonly commitSha?: string | null;
  readonly electronVersion?: string | null;
  readonly nodeVersion: string;
  readonly chromeVersion?: string | null;
  readonly platform: string;
  readonly osRelease: string;
  readonly arch: string;
  readonly mode: DokkaebiOperatingMode;
  readonly layout: UserDataLayout;
}

const PLATFORM_LABEL: Readonly<Record<string, string>> = Object.freeze({
  win32: "Windows",
  darwin: "macOS",
  linux: "Linux"
});

/** A commit SHA is shown short, and only if it looks like one. A truncated guess is worse than nothing. */
function shortCommit(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[0-9a-f]{7,40}$/i.test(trimmed) ? trimmed.slice(0, 12) : null;
}

export function buildAboutInfo(input: AboutInfoInput): AboutInfo {
  return Object.freeze({
    appName: input.appName,
    appVersion: input.appVersion,
    buildNumber: typeof input.buildNumber === "string" && input.buildNumber.trim().length > 0 ? input.buildNumber.trim() : null,
    commitSha: shortCommit(input.commitSha),
    electronVersion: input.electronVersion ?? null,
    nodeVersion: input.nodeVersion,
    chromeVersion: input.chromeVersion ?? null,
    operatingSystem: `${PLATFORM_LABEL[input.platform] ?? input.platform} ${input.osRelease}`.trim(),
    architecture: input.arch,
    environment: input.layout.environment,
    mode: input.mode,
    liveTradingDisabled: true,
    privateApiDisabled: true,
    credentialStorageDisabled: true,
    copyright: `© ${new Date().getUTCFullYear()} Dokkaebi`,
    license: "Proprietary — 개인 사용 목적의 모의 거래 도구입니다.",
    folders: Object.freeze([
      Object.freeze({ key: "LOGS" as const, label: "로그 폴더", absolutePath: input.layout.logsDirectory }),
      Object.freeze({ key: "EVIDENCE" as const, label: "Evidence 폴더", absolutePath: input.layout.evidenceDirectory }),
      Object.freeze({ key: "USER_DATA" as const, label: "사용자 데이터 폴더", absolutePath: input.layout.root })
    ])
  });
}

/**
 * The About payload with absolute paths stripped, which is what actually crosses to the
 * renderer. The folder KEYS survive so the buttons still work; the paths do not, so a
 * compromised or merely careless renderer has nothing to print.
 */
export function toRendererAboutInfo(info: AboutInfo): Omit<AboutInfo, "folders"> & { readonly folders: readonly Omit<AboutFolder, "absolutePath">[] } {
  return Object.freeze({
    ...info,
    folders: Object.freeze(info.folders.map((folder) => Object.freeze({ key: folder.key, label: folder.label })))
  });
}
