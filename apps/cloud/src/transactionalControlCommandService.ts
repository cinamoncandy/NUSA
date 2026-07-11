import type { ControlCommandRequest, ControlCommandResult, ControlRuntimeSnapshot } from "../../../packages/contracts/src/controlPlane";
import { SqliteControlPlaneStore } from "../../../packages/storage/src/controlPlaneStore";
import { appendControlAuditEvent, replayControlAuditLedger } from "./controlAuditLedger";
import { processControlCommand } from "./controlCommandProcessor";

export class TransactionalControlCommandService {
  public constructor(private readonly store: SqliteControlPlaneStore) {}

  public initialize(runtime: ControlRuntimeSnapshot): void {
    this.store.initialize(runtime);
    this.verifyPersistedState();
  }

  public execute(now: number, request: ControlCommandRequest): ControlCommandResult {
    return this.store.transaction(() => {
      const persisted = this.store.load();
      if (persisted == null) throw new Error("control plane is not initialized");

      const records = this.store.listAuditRecords();
      const replayed = replayControlAuditLedger(records);
      if (replayed.ledgerHash !== persisted.ledgerHash) throw new Error("control audit ledger hash does not match runtime state");
      if (replayed.mode !== persisted.runtime.mode) throw new Error("control audit mode does not match runtime state");
      if (replayed.killSwitchActive !== persisted.runtime.killSwitchActive) throw new Error("control audit kill-switch state does not match runtime state");

      const result = processControlCommand({
        now,
        request,
        state: {
          runtime: persisted.runtime,
          processedCommandIds: replayed.processedCommandIds
        }
      });

      const nextRecords = appendControlAuditEvent(records, result.audit);
      const nextRecord = nextRecords[nextRecords.length - 1];
      this.store.appendAndSave(nextRecord, result.runtime);
      return result;
    });
  }

  public verifyPersistedState(): void {
    const persisted = this.store.load();
    if (persisted == null) throw new Error("control plane is not initialized");
    const replayed = replayControlAuditLedger(this.store.listAuditRecords());
    if (replayed.ledgerHash !== persisted.ledgerHash) throw new Error("control audit ledger hash does not match runtime state");
    if (replayed.mode !== persisted.runtime.mode) throw new Error("control audit mode does not match runtime state");
    if (replayed.killSwitchActive !== persisted.runtime.killSwitchActive) throw new Error("control audit kill-switch state does not match runtime state");
  }
}
