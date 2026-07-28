import { createHash } from "node:crypto";
import type { PaperSide } from "./paperBroker";

export type ShadowPilotStatus = "IDLE" | "PRECHECK" | "READY" | "RUNNING" | "PAUSED" | "COMPLETED" | "HALTED" | "FAILED" | "INVALIDATED";
export interface ShadowPilotPrecheck { readonly paperOnly: boolean; readonly deploymentIntegrity: boolean; readonly reconciliation: boolean; readonly killSwitch: boolean; readonly openP0: boolean; readonly marketDataHealthy: boolean; readonly warmedUp: boolean; readonly automaticTrading: boolean; }
export interface ShadowPilotEvent { readonly sequence: number; readonly timestamp: number; readonly sessionId: string; readonly eventType: "SESSION_STARTED" | "SIGNAL_OBSERVED" | "HYPOTHETICAL_FILL" | "BLOCKED" | "SESSION_STOPPED"; readonly signalId: string; readonly commandId: string; readonly riskDecision: "ALLOW" | "REJECT" | "HALT"; readonly reasonCodes: readonly string[]; readonly hypotheticalOrderId?: string; readonly hypotheticalFillId?: string; readonly actualBrokerCallCount: 0; readonly actualOrderDelta: 0; readonly actualFillDelta: 0; readonly actualCashDelta: 0; readonly actualPositionDelta: 0; readonly previousEventSha256: string; readonly eventSha256: string; }
export interface ShadowPilotSession { readonly schemaVersion: 1; readonly sessionId: string; readonly createdAt: number; readonly startedAt?: number; readonly stoppedAt?: number; readonly status: ShadowPilotStatus; readonly sourceCommitSha: string; readonly symbol: string; readonly strategyId: string; readonly fingerprints: Readonly<{ strategy: string; config: string; runtime: string; riskPolicy: string }>; readonly counters: Readonly<{ signalCount: number; allowCount: number; rejectCount: number; haltCount: number; hypotheticalOrderCount: number; hypotheticalFillCount: number; actualOrderCount: number; actualFillCount: number; cashMutationCount: number; positionMutationCount: number }>; readonly blockers: readonly string[]; readonly resultSha256: string; }
const canonicalize = (value: unknown): unknown => value === null || typeof value !== "object" ? value : Array.isArray(value) ? value.map(canonicalize) : Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize((value as Record<string, unknown>)[key])]));
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
const emptyCounters = () => ({ signalCount: 0, allowCount: 0, rejectCount: 0, haltCount: 0, hypotheticalOrderCount: 0, hypotheticalFillCount: 0, actualOrderCount: 0 as const, actualFillCount: 0 as const, cashMutationCount: 0, positionMutationCount: 0 });

/** Paper-only, non-mutating pilot. It deliberately has no PaperBroker dependency. */
export class ShadowPilotRuntime {
  private status: ShadowPilotStatus = "IDLE"; private readonly events: ShadowPilotEvent[] = []; private readonly signalIds = new Set<string>(); private counters = emptyCounters(); private blockers: string[] = []; private startedAt?: number; private stoppedAt?: number;
  constructor(private readonly identity: Readonly<{ sessionId: string; createdAt: number; sourceCommitSha: string; symbol: string; strategyId: string; fingerprints: ShadowPilotSession["fingerprints"] }>) {}
  precheck(input: ShadowPilotPrecheck): ShadowPilotStatus { if (this.status !== "IDLE") throw new Error("shadow pilot is not idle"); this.status = "PRECHECK"; this.blockers = [!input.paperOnly && "NOT_PAPER_ONLY", !input.deploymentIntegrity && "DEPLOYMENT_INTEGRITY_FAILED", !input.reconciliation && "RECONCILIATION_REQUIRED", input.killSwitch && "KILL_SWITCH_ACTIVE", input.openP0 && "OPEN_P0_ALERT", !input.marketDataHealthy && "MARKET_DATA_UNHEALTHY", !input.warmedUp && "MARKET_DATA_WARMING_UP", input.automaticTrading && "AUTOMATIC_TRADING_ON"].filter((value): value is string => Boolean(value)); this.status = this.blockers.length ? "HALTED" : "READY"; return this.status; }
  start(now: number): void { if (this.status !== "READY") throw new Error("shadow pilot requires explicit ready start"); this.status = "RUNNING"; this.startedAt = now; this.append("SESSION_STARTED", now, "session", "session", "ALLOW", []); }
  observe(input: Readonly<{ timestamp: number; signalId: string; commandId: string; side: PaperSide; quantity: number; decision: "ALLOW" | "REJECT" | "HALT"; reasonCodes: readonly string[] }>): void { if (this.status !== "RUNNING") throw new Error("shadow pilot is not running"); if (this.signalIds.has(input.signalId)) { this.append("BLOCKED", input.timestamp, input.signalId, input.commandId, "REJECT", ["DUPLICATE_SIGNAL"]); this.counters = { ...this.counters, signalCount: this.counters.signalCount + 1, rejectCount: this.counters.rejectCount + 1 }; return; } this.signalIds.add(input.signalId); const next = { ...this.counters, signalCount: this.counters.signalCount + 1 }; if (input.decision === "ALLOW") { this.counters = { ...next, allowCount: next.allowCount + 1, hypotheticalOrderCount: next.hypotheticalOrderCount + 1, hypotheticalFillCount: next.hypotheticalFillCount + 1 }; this.append("HYPOTHETICAL_FILL", input.timestamp, input.signalId, input.commandId, input.decision, input.reasonCodes, `shadow-order-${this.identity.sessionId}-${this.events.length + 1}`, `shadow-fill-${this.identity.sessionId}-${this.events.length + 1}`); } else { this.counters = input.decision === "HALT" ? { ...next, haltCount: next.haltCount + 1 } : { ...next, rejectCount: next.rejectCount + 1 }; this.append("BLOCKED", input.timestamp, input.signalId, input.commandId, input.decision, input.reasonCodes); if (input.decision === "HALT") this.status = "HALTED"; } }
  stop(now: number): void { if (this.status !== "RUNNING" && this.status !== "HALTED") throw new Error("shadow pilot cannot stop from current state"); this.append("SESSION_STOPPED", now, "session-stop", "session-stop", "ALLOW", []); this.stoppedAt = now; if (this.status !== "HALTED") this.status = "COMPLETED"; }
  eventLog(): readonly ShadowPilotEvent[] { return Object.freeze([...this.events]); }
  snapshot(): ShadowPilotSession { const raw = { schemaVersion: 1 as const, sessionId: this.identity.sessionId, createdAt: this.identity.createdAt, ...(this.startedAt === undefined ? {} : { startedAt: this.startedAt }), ...(this.stoppedAt === undefined ? {} : { stoppedAt: this.stoppedAt }), status: this.status, sourceCommitSha: this.identity.sourceCommitSha, symbol: this.identity.symbol, strategyId: this.identity.strategyId, fingerprints: this.identity.fingerprints, counters: this.counters, blockers: Object.freeze([...this.blockers].sort()) }; return Object.freeze({ ...raw, resultSha256: hash(raw) }); }
  private append(eventType: ShadowPilotEvent["eventType"], timestamp: number, signalId: string, commandId: string, riskDecision: ShadowPilotEvent["riskDecision"], reasonCodes: readonly string[], hypotheticalOrderId?: string, hypotheticalFillId?: string): void { const raw = { sequence: this.events.length + 1, timestamp, sessionId: this.identity.sessionId, eventType, signalId, commandId, riskDecision, reasonCodes: Object.freeze([...reasonCodes].sort()), ...(hypotheticalOrderId ? { hypotheticalOrderId } : {}), ...(hypotheticalFillId ? { hypotheticalFillId } : {}), actualBrokerCallCount: 0 as const, actualOrderDelta: 0 as const, actualFillDelta: 0 as const, actualCashDelta: 0 as const, actualPositionDelta: 0 as const, previousEventSha256: this.events.at(-1)?.eventSha256 ?? "GENESIS" }; this.events.push(Object.freeze({ ...raw, eventSha256: hash(raw) })); }
}

export function verifyShadowPilotEvents(events: readonly ShadowPilotEvent[], sourceCommitSha: string): readonly string[] { const errors: string[] = []; let previous = "GENESIS"; const seen = new Set<string>(); for (let index = 0; index < events.length; index += 1) { const event = events[index]!; if (event.sequence !== index + 1) errors.push("MISSING_SEQUENCE"); if (seen.has(event.eventSha256)) errors.push("DUPLICATE_EVENT"); seen.add(event.eventSha256); const { eventSha256, ...raw } = event; if (event.previousEventSha256 !== previous || hash(raw) !== eventSha256) errors.push("EVENT_HASH_MISMATCH"); if (event.actualBrokerCallCount !== 0 || event.actualOrderDelta !== 0 || event.actualFillDelta !== 0 || event.actualCashDelta !== 0 || event.actualPositionDelta !== 0) errors.push("SHADOW_MUTATION"); previous = event.eventSha256; } if (!sourceCommitSha) errors.push("SOURCE_COMMIT_MISSING"); return Object.freeze([...new Set(errors)].sort()); }

/**
 * An incremental verifier over the same append-only log (WO-0034-A4J).
 *
 * `verifyShadowPilotEvents` re-hashes every event on every call. The runtime calls it once
 * per signal, so a session that produces N signals hashes O(N^2) events. Measured on this
 * codebase: 1,600 signals spend 13.1 of their 13.2 seconds inside that one call, and the
 * per-signal cost grows 10x between 100 and 1,600 signals. On the main process that is
 * time the UI is not running.
 *
 * This remembers how far it got and re-hashes only the events appended since. The boundary
 * check -- same length or longer, same recorded hash at the boundary -- catches a truncated
 * log, a replaced tail and a different session's array, and falls back to verifying
 * everything when it fires.
 *
 * WHAT THIS DOES NOT CATCH, stated plainly because the distinction is easy to get wrong:
 * an event that is REPLACED AFTER it was already verified, in the middle of the log, while
 * the log's length and its last event are unchanged. The boundary check reads the stored
 * `eventSha256` of the boundary event; it does not re-derive it, so a substitution behind
 * the boundary is invisible to it. A hash chain proves a prefix only when every link is
 * recomputed, which is exactly the O(N) work being avoided.
 *
 * That gap is closed elsewhere, not ignored:
 *
 *   - The pilot's events are individually frozen and pushed to an append-only array, so
 *     nothing in normal operation rewrites one. The real fault this guards against is a
 *     runtime bug producing a bad NEW event, which the incremental path checks in full.
 *   - `ShadowOperationalRuntime.stop()` runs the complete `verifyShadowPilotEvents` once
 *     before sealing, so no session is ever sealed on incremental evidence alone.
 *   - `verifyShadowEvidenceDirectory` re-reads the archive from disk and re-derives every
 *     hash independently, which is the check that actually certifies a session.
 *
 * Within those limits it returns exactly what the full function returns. A test asserts the
 * equivalence on every step of a growing log, and another records the mid-log substitution
 * gap so it stays a known, tested boundary rather than an assumption.
 */
export interface ShadowPilotEventVerifier {
  verify(events: readonly ShadowPilotEvent[], sourceCommitSha: string): readonly string[];
}

export function createShadowPilotEventVerifier(): ShadowPilotEventVerifier {
  let verifiedCount = 0;
  let verifiedTailHash = "GENESIS";
  let seen = new Set<string>();
  let carriedErrors: string[] = [];

  const restart = (): void => {
    verifiedCount = 0;
    verifiedTailHash = "GENESIS";
    seen = new Set<string>();
    carriedErrors = [];
  };

  return {
    verify(events, sourceCommitSha) {
      // The boundary check. The boundary event is RE-HASHED, not merely compared: comparing
      // its stored `eventSha256` to the remembered value catches nothing, because a caller
      // rewriting the event would leave that field alone. Re-deriving it costs one hash and
      // makes every field of the boundary event count.
      if (verifiedCount > 0) {
        const boundary = events[verifiedCount - 1];
        let intact = events.length >= verifiedCount && boundary !== undefined && boundary.eventSha256 === verifiedTailHash;
        if (intact && boundary !== undefined) {
          const { eventSha256, ...raw } = boundary;
          intact = hash(raw) === eventSha256;
        }
        if (!intact) restart();
      }

      const errors: string[] = [...carriedErrors];
      let previous = verifiedTailHash;
      for (let index = verifiedCount; index < events.length; index += 1) {
        const event = events[index]!;
        if (event.sequence !== index + 1) errors.push("MISSING_SEQUENCE");
        if (seen.has(event.eventSha256)) errors.push("DUPLICATE_EVENT");
        seen.add(event.eventSha256);
        const { eventSha256, ...raw } = event;
        if (event.previousEventSha256 !== previous || hash(raw) !== eventSha256) errors.push("EVENT_HASH_MISMATCH");
        if (event.actualBrokerCallCount !== 0 || event.actualOrderDelta !== 0 || event.actualFillDelta !== 0 || event.actualCashDelta !== 0 || event.actualPositionDelta !== 0) errors.push("SHADOW_MUTATION");
        previous = event.eventSha256;
      }

      verifiedCount = events.length;
      verifiedTailHash = previous;
      // Errors are carried, not recomputed: a fault found at sequence 5 must keep being
      // reported at sequence 500, exactly as the full verifier would report it.
      carriedErrors = [...errors];

      if (!sourceCommitSha) errors.push("SOURCE_COMMIT_MISSING");
      return Object.freeze([...new Set(errors)].sort());
    }
  };
}
