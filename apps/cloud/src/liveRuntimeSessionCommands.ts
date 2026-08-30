import type { LiveRuntimeSession } from "./liveRuntimeSessionBoundary";
import { engageLiveKillSwitch, stopLiveRuntimeSession } from "./liveRuntimeSessionBoundary";
import { LiveRuntimeSessionDurableStore, type LiveRuntimeSessionRecord } from "./liveRuntimeSessionDurableStore";

export type LiveRuntimeSessionCommand =
  | Readonly<{ type: "START" }>
  | Readonly<{ type: "STOP" }>
  | Readonly<{ type: "SET_CAPITAL_WEIGHT"; investmentCapitalWeight: number }>
  | Readonly<{ type: "ENGAGE_KILL_SWITCH" }>;

export type LiveRuntimeSessionCommandResult =
  | Readonly<{ status: "APPLIED"; record: LiveRuntimeSessionRecord }>
  | Readonly<{ status: "REJECTED"; reason: string }>;

function validOwner(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function applyLiveRuntimeSessionCommand(
  store: LiveRuntimeSessionDurableStore,
  ownerPrincipalId: string,
  expectedRevision: number,
  command: LiveRuntimeSessionCommand,
  nowMs: number,
): Promise<LiveRuntimeSessionCommandResult> {
  if (!validOwner(ownerPrincipalId)) return { status: "REJECTED", reason: "OWNER_REQUIRED" };
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return { status: "REJECTED", reason: "REVISION_INVALID" };
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return { status: "REJECTED", reason: "TIME_INVALID" };

  const current = await store.read(ownerPrincipalId);
  if (!current) return { status: "REJECTED", reason: "SESSION_UNAVAILABLE" };
  if (current.revision !== expectedRevision) return { status: "REJECTED", reason: "REVISION_CONFLICT" };
  if (current.session.ownerPrincipalId !== ownerPrincipalId) return { status: "REJECTED", reason: "OWNER_MISMATCH" };
  if (current.session.state === "REVOKED") return { status: "REJECTED", reason: "SESSION_REVOKED" };

  let next: LiveRuntimeSession;
  switch (command.type) {
    case "START":
      if (current.session.killSwitchEngaged) return { status: "REJECTED", reason: "KILL_SWITCH_ENGAGED" };
      if (nowMs < current.session.activatedAtMs || nowMs >= current.session.expiresAtMs) return { status: "REJECTED", reason: "SESSION_WINDOW_INACTIVE" };
      next = { ...current.session, state: "ACTIVE" };
      break;
    case "STOP":
      next = stopLiveRuntimeSession(current.session);
      break;
    case "SET_CAPITAL_WEIGHT":
      if (!Number.isFinite(command.investmentCapitalWeight) || command.investmentCapitalWeight <= 0 || command.investmentCapitalWeight > 1) {
        return { status: "REJECTED", reason: "CAPITAL_WEIGHT_INVALID" };
      }
      next = { ...current.session, investmentCapitalWeight: command.investmentCapitalWeight };
      break;
    case "ENGAGE_KILL_SWITCH":
      next = engageLiveKillSwitch(current.session);
      break;
    default:
      return { status: "REJECTED", reason: "COMMAND_INVALID" };
  }

  const stored = await store.write(next, expectedRevision);
  return stored.status === "STORED"
    ? { status: "APPLIED", record: stored.record }
    : { status: "REJECTED", reason: stored.reason };
}
