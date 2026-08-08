import { replayControlAuditLedger, type ControlAuditRecord } from "./controlAuditLedger";
import { replayP0AlertLedger, type P0AlertRecord } from "./p0AlertLedger";

/**
 * The `getControl()` input to the operational Paper risk gate must be reconstructed from durable,
 * independently verifiable safety evidence. Kill-switch state comes from the control audit ledger;
 * P0 incident state comes from the P0 alert ledger. Neither state may be replaced with a literal
 * because both are HALT-capable inputs to the independent Risk Governor.
 *
 * `p0Records` defaults to an empty ledger for backwards-compatible callers that only provide the
 * historical control-audit ledger. Production composition must pass the durable P0 ledger
 * explicitly; the default exists only so adding the second independent safety input does not break
 * existing kill-switch-only call sites and tests.
 */
export interface PaperEngineControlState {
  readonly killSwitchActive: boolean;
  readonly openP0: boolean;
}

export function readPaperEngineControlState(
  controlRecords: readonly ControlAuditRecord[],
  p0Records: readonly P0AlertRecord[] = Object.freeze([])
): PaperEngineControlState {
  const control = replayControlAuditLedger(controlRecords);
  const p0 = replayP0AlertLedger(p0Records);
  return Object.freeze({ killSwitchActive: control.killSwitchActive, openP0: p0.openP0 });
}
