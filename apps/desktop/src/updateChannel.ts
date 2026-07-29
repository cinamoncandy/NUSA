/**
 * Update-channel structure WITHOUT an updater (WO-0034-A4O req 9).
 *
 * A4O explicitly does not enable automatic updates, and this file does not implement one. It
 * reaches no network, downloads nothing, and installs nothing -- a static analysis test in
 * this repository asserts exactly that. What it does is fix the shape of the decision now, so
 * that adding an updater later is wiring rather than redesign.
 *
 * The part worth getting right up front is the REFUSAL rules. An updater is the one component
 * that can replace the whole application, so its "when do I decline" list has to exist before
 * its "how do I install" list does. Those rules are here, executable and tested, with no
 * transport behind them yet.
 */

export type UpdateChannel = "stable" | "beta";

export const UPDATE_CHANNELS: readonly UpdateChannel[] = Object.freeze(["stable", "beta"]);
export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = "stable";

export interface UpdateChannelState {
  readonly channel: UpdateChannel;
  readonly currentVersion: string;
  /** Always false in this build. There is no updater to enable. */
  readonly automaticUpdatesEnabled: false;
  /** Always true. An unsigned artefact is never installed, on any channel. */
  readonly requiresSignedArtifact: true;
  readonly lastCheckedAt: null;
  readonly note: string;
}

export function normalizeUpdateChannel(value: unknown): UpdateChannel {
  return UPDATE_CHANNELS.includes(value as UpdateChannel) ? (value as UpdateChannel) : DEFAULT_UPDATE_CHANNEL;
}

export function updateChannelState(currentVersion: string, channel: unknown = DEFAULT_UPDATE_CHANNEL): UpdateChannelState {
  return Object.freeze({
    channel: normalizeUpdateChannel(channel),
    currentVersion,
    automaticUpdatesEnabled: false,
    requiresSignedArtifact: true,
    lastCheckedAt: null,
    note: "이 버전은 자동 업데이트를 사용하지 않습니다. 새 버전은 직접 내려받아 설치하셔야 합니다."
  });
}

export type UpdateRejectionReason =
  | "AUTOMATIC_UPDATES_DISABLED"
  | "UNSIGNED_ARTIFACT"
  | "SIGNATURE_UNVERIFIED"
  | "CHANNEL_MISMATCH"
  | "NOT_NEWER_THAN_CURRENT";

export interface UpdateCandidate {
  readonly version: string;
  readonly channel: UpdateChannel;
  readonly signaturePresent: boolean;
  readonly signatureVerified: boolean;
}

export interface UpdateDecision {
  readonly install: false;
  /** Every reason the candidate was declined, so a log line says all of what was wrong. */
  readonly reasons: readonly UpdateRejectionReason[];
  /** The version that keeps running. A declined update never leaves the app without one. */
  readonly retainedVersion: string;
}

/**
 * Evaluates an update candidate. `install` is typed as `false`: there is no updater, so no
 * input can produce an installation, and the type says so rather than leaving it to a
 * runtime check someone could later relax.
 *
 * All applicable reasons are collected rather than returning the first: an artefact that is
 * both unsigned and from the wrong channel has two problems, and reporting one of them sends
 * whoever is debugging it round the loop twice.
 */
export function evaluateUpdateCandidate(candidate: UpdateCandidate, state: UpdateChannelState): UpdateDecision {
  const reasons: UpdateRejectionReason[] = ["AUTOMATIC_UPDATES_DISABLED"];
  if (!candidate.signaturePresent) reasons.push("UNSIGNED_ARTIFACT");
  else if (!candidate.signatureVerified) reasons.push("SIGNATURE_UNVERIFIED");
  if (candidate.channel !== state.channel) reasons.push("CHANNEL_MISMATCH");
  if (compareVersions(candidate.version, state.currentVersion) <= 0) reasons.push("NOT_NEWER_THAN_CURRENT");
  return Object.freeze({ install: false as const, reasons: Object.freeze(reasons), retainedVersion: state.currentVersion });
}

/** Numeric dotted comparison. Unparseable segments sort as 0 rather than throwing. */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => String(value).split(".").map((part) => {
    const numeric = Number.parseInt(part, 10);
    return Number.isSafeInteger(numeric) ? numeric : 0;
  });
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}
