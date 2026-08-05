import { replayControlAuditLedger, type ControlAuditRecord } from "./controlAuditLedger";

/**
 * The `getControl()` input `createOperationalPaperRiskGate` (paperOperationalPreflight.ts)
 * needs to actually block a new order on kill switch. On desktop this is a persisted
 * `killSwitchActive` boolean loaded from a safety snapshot, decoupled from `ControlPlane`'s
 * own run/pause/auto-trade status -- `ControlPlane` never was the kill switch there either.
 *
 * On cloud, the source of truth for "has an EMERGENCY_STOP been accepted" is the hash-chained
 * control audit ledger (controlAuditLedger.ts), not a local variable: a mobile client submits
 * an EMERGENCY_STOP control command, it is appended to the ledger, and `replayControlAuditLedger`
 * derives `killSwitchActive` by replaying every event from genesis. This function is the one
 * place that reads that replayed state and hands it to the risk gate -- so an accepted
 * EMERGENCY_STOP actually removes ALLOW from every subsequent `evaluatePreTradeRisk` call
 * (independentRiskGateway.ts checks `controlState.killSwitchActive` unconditionally), not just
 * a ledger entry that nothing downstream reads.
 *
 * `ControlPlane` is still ported and still used by `RuntimeCommandService` for orchestration
 * (running/paused status, auto-trade toggle, the operational event log) -- none of that is a
 * safety mechanism, so it stays exactly as it was on desktop. Only the kill-switch INPUT to the
 * risk gate changes source.
 */
export interface PaperEngineControlState {
  readonly killSwitchActive: boolean;
  readonly openP0: boolean;
}

/**
 * `openP0` is always `false` here: cloud has no P0 alert ledger yet (desktop's equivalent is a
 * persisted open-alerts list, not part of this port's scope). This is a stated gap, not a claim
 * that no P0 condition could exist -- see the accompanying PR description.
 */
export function readPaperEngineControlState(records: readonly ControlAuditRecord[]): PaperEngineControlState {
  const replayed = replayControlAuditLedger(records);
  // safety-input-literal-ok: tracked gap, not a hidden one. OPEN_P0_ALERT is a HALT-level reason
  // code in independentRiskGateway.ts and this constant is the only thing standing between the
  // cloud path and it, so it stays visible to scripts/check-safety-input-literals.js rather than
  // silently outside its scanned field list. Remove this waiver only alongside building real P0
  // alert tracking for cloud, not by widening the literal's justification.
  return Object.freeze({ killSwitchActive: replayed.killSwitchActive, openP0: false });
}
