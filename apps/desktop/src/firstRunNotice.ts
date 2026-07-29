import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { UserDataLayout } from "./userDataLayout";

/**
 * The safety notice a user sees before the app is usable (WO-0034-A4O req 1).
 *
 * Two rules shape this file:
 *
 *   1. It is shown ONCE. An acknowledgement the user has to dismiss on every launch stops
 *      being read by the third launch, and a notice nobody reads is worse than no notice --
 *      it looks like informed consent while being a reflex.
 *   2. It is shown AGAIN when the safety policy itself changes. That is the only condition.
 *      Not on version bumps, not on updates: a user who agreed to "no live orders" has not
 *      agreed to anything different just because the build number moved.
 *
 * `SAFETY_POLICY_VERSION` is therefore bumped only when one of the statements below stops
 * being true or a new one is added. Changing wording does not qualify.
 */

export const SAFETY_POLICY_VERSION = 1 as const;

export type DokkaebiOperatingMode = "PAPER" | "SHADOW";

export interface FirstRunNoticeStatement {
  readonly code: string;
  readonly text: string;
}

/**
 * The statements themselves. Written as facts the code enforces elsewhere, not as promises:
 * every one of these is asserted by a test somewhere in this repository.
 */
export const FIRST_RUN_STATEMENTS: readonly FirstRunNoticeStatement[] = Object.freeze([
  Object.freeze({ code: "LIVE_TRADING_DISABLED", text: "실제 주문 기능이 꺼져 있습니다. 이 앱은 실제 거래를 하지 않습니다." }),
  Object.freeze({ code: "NO_PRIVATE_API", text: "업비트 Private API를 사용하지 않습니다." }),
  Object.freeze({ code: "NO_CREDENTIALS", text: "API 키를 입력하실 필요가 없고, 입력받는 화면 자체가 없습니다." }),
  Object.freeze({ code: "HYPOTHETICAL_FILLS_ONLY", text: "체결은 전부 가상이며 기록용입니다. 실제 자산은 움직이지 않습니다." }),
  Object.freeze({ code: "PUBLIC_MARKET_DATA", text: "시세는 업비트의 공개 데이터만 사용합니다." })
]);

export interface FirstRunNotice {
  readonly safetyPolicyVersion: number;
  readonly mode: DokkaebiOperatingMode;
  readonly statements: readonly FirstRunNoticeStatement[];
  /** Where the user's own data lives, so the notice is not an abstract promise. */
  readonly evidenceDirectory: string;
  readonly logsDirectory: string;
  readonly userDataDirectory: string;
}

export interface FirstRunAcknowledgement {
  readonly schemaVersion: 1;
  readonly acknowledgedAt: number;
  readonly safetyPolicyVersion: number;
}

export interface FirstRunState {
  readonly required: boolean;
  /** Why the notice is being shown, so the UI can say "policy changed" rather than repeat itself. */
  readonly reason: FirstRunReason;
  readonly acknowledgedAt: number | null;
  readonly acknowledgedPolicyVersion: number | null;
  readonly notice: FirstRunNotice;
}

function parseAcknowledgement(value: unknown): FirstRunAcknowledgement | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Partial<Record<keyof FirstRunAcknowledgement, unknown>>;
  if (record.schemaVersion !== 1) return null;
  if (!Number.isSafeInteger(record.acknowledgedAt) || (record.acknowledgedAt as number) <= 0) return null;
  if (!Number.isSafeInteger(record.safetyPolicyVersion) || (record.safetyPolicyVersion as number) < 1) return null;
  return Object.freeze({
    schemaVersion: 1,
    acknowledgedAt: record.acknowledgedAt as number,
    safetyPolicyVersion: record.safetyPolicyVersion as number
  });
}

export type FirstRunReason = "NEVER_ACKNOWLEDGED" | "SAFETY_POLICY_CHANGED" | "ALREADY_ACKNOWLEDGED";

/**
 * The whole decision, as a pure function of what is stored and which policy is current.
 *
 * Extracted so the "policy changed" branch can be exercised against a real policy version
 * other than today's. Testing it through the store alone is impossible while
 * SAFETY_POLICY_VERSION is 1: there is no valid lower version to write, so the branch would
 * be reachable only by the future edit that bumps it -- which is exactly when a regression
 * would be least welcome.
 */
export function firstRunDecision(stored: FirstRunAcknowledgement | null, currentPolicyVersion: number): Readonly<{ required: boolean; reason: FirstRunReason }> {
  if (stored === null) return Object.freeze({ required: true, reason: "NEVER_ACKNOWLEDGED" as const });
  // Strictly less-than, so an acknowledgement written by a NEWER build is not re-prompted
  // after a downgrade -- the user really did read a policy at least as strict as this one.
  if (stored.safetyPolicyVersion < currentPolicyVersion) return Object.freeze({ required: true, reason: "SAFETY_POLICY_CHANGED" as const });
  return Object.freeze({ required: false, reason: "ALREADY_ACKNOWLEDGED" as const });
}

/** Exposed so a test can build a stored record without hand-rolling the schema. */
export function parseFirstRunAcknowledgement(value: unknown): FirstRunAcknowledgement | null {
  return parseAcknowledgement(value);
}

export class FirstRunNoticeStore {
  constructor(private readonly layout: UserDataLayout, private readonly mode: DokkaebiOperatingMode = "PAPER") {}

  notice(): FirstRunNotice {
    return Object.freeze({
      safetyPolicyVersion: SAFETY_POLICY_VERSION,
      mode: this.mode,
      statements: FIRST_RUN_STATEMENTS,
      evidenceDirectory: this.layout.evidenceDirectory,
      logsDirectory: this.layout.logsDirectory,
      userDataDirectory: this.layout.root
    });
  }

  /**
   * An unreadable or corrupt acknowledgement counts as never acknowledged. Failing towards
   * showing the notice is the safe direction: the cost is one extra screen, and the cost of
   * the other choice is a user who never saw it.
   */
  state(): FirstRunState {
    let stored: FirstRunAcknowledgement | null = null;
    try {
      stored = parseAcknowledgement(JSON.parse(readFileSync(this.layout.firstRunFile, "utf8")));
    } catch {
      stored = null;
    }
    const decision = firstRunDecision(stored, SAFETY_POLICY_VERSION);
    return Object.freeze({
      required: decision.required,
      reason: decision.reason,
      acknowledgedAt: stored?.acknowledgedAt ?? null,
      acknowledgedPolicyVersion: stored?.safetyPolicyVersion ?? null,
      notice: this.notice()
    });
  }

  /**
   * Records that the user confirmed. `confirmed` has no default: a caller that forgets to
   * pass it acknowledges nothing, rather than acknowledging on the user's behalf.
   */
  acknowledge(confirmed: boolean, now: number = Date.now()): FirstRunState {
    if (confirmed !== true) throw new Error("first-run notice requires an explicit confirmation");
    const record: FirstRunAcknowledgement = Object.freeze({ schemaVersion: 1, acknowledgedAt: now, safetyPolicyVersion: SAFETY_POLICY_VERSION });
    mkdirSync(path.dirname(this.layout.firstRunFile), { recursive: true });
    writeFileSync(this.layout.firstRunFile, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return this.state();
  }
}
