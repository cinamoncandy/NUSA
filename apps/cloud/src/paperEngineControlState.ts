import { replayControlAuditLedger, type ControlAuditRecord } from "./controlAuditLedger";
import { replayP0AlertLedger, type P0AlertRecord } from "./p0AlertLedger";

/**
 * The `getControl()` input to the operational Paper risk gate must be reconstructed from durable,
 * independently verifiable safety evidence. Kill-switch state comes from the control audit ledger;
 * P0 incident state comes from the P0 alert ledger. Neither state may be replaced with a literal
 * because both are HALT-capable inputs to the independent Risk Governor.
 */
export interface PaperEngineControlState {
  readonly killSwitchActive: boolean;
  readonly openP0: boolean;
}

export function readPaperEngineControlState(
  controlRecords: readonly ControlAuditRecord[],
  p0Records: readonly P0AlertRecord[]
): PaperEngineControlState {
  const control = replayControlAuditLedger(controlRecords);
  const p0 = replayP0AlertLedger(p0Records);
  return Object.freeze({ killSwitchActive: control.killSwitchActive, openP0: p0.openP0 });
}
