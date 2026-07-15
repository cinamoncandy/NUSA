import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { runMigrations } from "../../../packages/storage/src/migrationRunner";
import type { ControlPlaneState } from "./controlPlane";
import type { PaperBrokerState, PaperOrder } from "./paperBroker";
import type { PaperScenarioEvent } from "../../cloud/src/paperScenarioEvidenceLedger";

const SCENARIO_EVENT_TYPES = new Set(["SESSION_OBSERVED", "ORDER_COMPLETED", "REGIME_OBSERVED", "RECOVERY_COMPLETED", "DUPLICATE_ORDER_CHECKED", "FAULT_SCENARIO_PASSED"]);

export interface DesktopPersistenceState { readonly paper: PaperBrokerState; readonly control: ControlPlaneState; }

const migrations = [{ id: "001_desktop_runtime", sql: `
CREATE TABLE desktop_account_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
CREATE TABLE desktop_orders (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, payload TEXT NOT NULL);
CREATE TABLE desktop_control_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL);
CREATE TABLE desktop_control_events (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, payload TEXT NOT NULL);
CREATE TABLE desktop_processed_signal_keys (signal_key TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE);
CREATE TABLE desktop_imports (source TEXT PRIMARY KEY, imported_at TEXT NOT NULL);
` }, { id: "002_desktop_scenario_evidence", sql: `
CREATE TABLE desktop_paper_scenario_evidence (sequence INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, event_json TEXT NOT NULL);
` }];

export class DesktopPersistenceStore {
  private readonly db: DatabaseSync;

  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    try {
      this.configureSafetyPragmas();
      this.verifyStartupIntegrity();
      runMigrations(this.db, migrations);
    } catch (error) {
      this.db.close();
      throw new Error("desktop persistence startup verification failed", { cause: error });
    }
  }

  load(): DesktopPersistenceState | undefined {
    const account = this.db.prepare("SELECT payload FROM desktop_account_state WHERE id = 1").get() as { payload: string } | undefined;
    const control = this.db.prepare("SELECT payload FROM desktop_control_state WHERE id = 1").get() as { payload: string } | undefined;
    if (account == null && control == null) return undefined;
    if (account == null || control == null) throw new Error("partial desktop persistence state");
    const paperBase = JSON.parse(account.payload) as Omit<PaperBrokerState, "orders">;
    const controlBase = JSON.parse(control.payload) as Omit<ControlPlaneState, "events" | "processedSignalKeys">;
    const orders = (this.db.prepare("SELECT payload FROM desktop_orders ORDER BY ordinal").all() as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as PaperOrder);
    const events = (this.db.prepare("SELECT payload FROM desktop_control_events ORDER BY ordinal").all() as Array<{ payload: string }>).map((row) => JSON.parse(row.payload) as ControlPlaneState["events"][number]);
    const processedSignalKeys = (this.db.prepare("SELECT signal_key FROM desktop_processed_signal_keys ORDER BY ordinal").all() as Array<{ signal_key: string }>).map((row) => row.signal_key);
    return { paper: { ...paperBase, orders }, control: { ...controlBase, events, processedSignalKeys } };
  }

  importLegacy(state: DesktopPersistenceState): boolean {
    if (this.load() != null) return false;
    return this.transaction(() => {
      const imported = this.db.prepare("SELECT 1 FROM desktop_imports WHERE source = 'paper-control-json'").get();
      if (imported != null) return false;
      this.write(state);
      this.db.prepare("INSERT INTO desktop_imports (source, imported_at) VALUES (?, ?)").run("paper-control-json", new Date().toISOString());
      return true;
    });
  }

  save(paper: PaperBrokerState, control: ControlPlaneState): void {
    this.transaction(() => this.write({ paper, control }));
  }

  saveWithScenarioEvent(paper: PaperBrokerState, control: ControlPlaneState, event: PaperScenarioEvent): void {
    this.saveWithScenarioEvents(paper, control, [event]);
  }

  saveWithScenarioEvents(paper: PaperBrokerState, control: ControlPlaneState, events: readonly PaperScenarioEvent[]): void {
    if (events.length === 0) throw new Error("scenario evidence batch must not be empty");
    this.transaction(() => {
      this.write({ paper, control });
      let next = Number((this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM desktop_paper_scenario_evidence").get() as { sequence: number }).sequence) + 1;
      const insert = this.db.prepare("INSERT INTO desktop_paper_scenario_evidence (sequence, event_id, event_json) VALUES (?, ?, ?)");
      for (const event of events) {
        insert.run(next, event.eventId, JSON.stringify(event));
        next += 1;
      }
    });
  }

  loadScenarioEvents(): readonly PaperScenarioEvent[] {
    const rows = this.db.prepare("SELECT sequence, event_id, event_json FROM desktop_paper_scenario_evidence ORDER BY sequence ASC").all() as Array<{ sequence: number; event_id: string; event_json: string }>;
    const events: PaperScenarioEvent[] = [];
    let expectedSequence = 1;
    const ids = new Set<string>();
    for (const row of rows) {
      if (row.sequence !== expectedSequence) throw new Error("scenario evidence sequence is not contiguous");
      expectedSequence += 1;
      if (ids.has(row.event_id)) throw new Error("duplicate scenario evidence event id");
      ids.add(row.event_id);
      let event: PaperScenarioEvent;
      try { event = JSON.parse(row.event_json) as PaperScenarioEvent; } catch (error) { throw new Error("scenario evidence event JSON is invalid", { cause: error }); }
      if (event.eventId !== row.event_id) throw new Error("scenario evidence DB/event ID mismatch");
      if (!SCENARIO_EVENT_TYPES.has(event.type)) throw new Error("unsupported scenario evidence event type");
      if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) throw new Error("scenario evidence occurredAt is invalid");
      if (event.sessionId !== undefined && (!event.sessionId || typeof event.sessionId !== "string")) throw new Error("scenario evidence sessionId is invalid");
      if (event.scenario !== undefined && (!event.scenario || typeof event.scenario !== "string")) throw new Error("scenario evidence scenario is invalid");
      events.push(Object.freeze({ ...event }));
    }
    for (let index = 1; index < events.length; index += 1) if (events[index]!.occurredAt < events[index - 1]!.occurredAt) throw new Error("scenario evidence ordering is invalid");
    return Object.freeze(events);
  }

  loadScenarioEvidenceRecords(): readonly PaperScenarioEvent[] {
    return this.loadScenarioEvents();
  }

  close(): void { this.db.close(); }

  private configureSafetyPragmas(): void {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = FULL");
    this.db.exec("PRAGMA busy_timeout = 5000");

    const foreignKeys = Number((this.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys);
    const journalMode = String((this.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toLowerCase();
    const synchronous = Number((this.db.prepare("PRAGMA synchronous").get() as { synchronous: number }).synchronous);
    const busyTimeout = Number((this.db.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout);
    if (foreignKeys !== 1 || journalMode !== "wal" || synchronous !== 2 || busyTimeout !== 5000) {
      throw new Error("required SQLite safety pragmas were not applied");
    }
  }

  private verifyStartupIntegrity(): void {
    const rows = this.db.prepare("PRAGMA quick_check").all() as Array<{ quick_check: string }>;
    if (rows.length !== 1 || rows[0]?.quick_check !== "ok") throw new Error("SQLite quick_check failed");
  }

  private write({ paper, control }: DesktopPersistenceState): void {
    const { orders, ...paperBase } = paper;
    const { events, processedSignalKeys, ...controlBase } = control;
    this.db.prepare("INSERT OR REPLACE INTO desktop_account_state (id, payload) VALUES (1, ?)").run(JSON.stringify(paperBase));
    this.db.exec("DELETE FROM desktop_orders");
    const orderInsert = this.db.prepare("INSERT INTO desktop_orders (id, ordinal, payload) VALUES (?, ?, ?)");
    orders.forEach((order, ordinal) => orderInsert.run(order.id, ordinal, JSON.stringify(order)));
    this.db.prepare("INSERT OR REPLACE INTO desktop_control_state (id, payload) VALUES (1, ?)").run(JSON.stringify(controlBase));
    this.db.exec("DELETE FROM desktop_control_events; DELETE FROM desktop_processed_signal_keys");
    const eventInsert = this.db.prepare("INSERT INTO desktop_control_events (id, ordinal, payload) VALUES (?, ?, ?)");
    events.forEach((event, ordinal) => eventInsert.run(event.id, ordinal, JSON.stringify(event)));
    const signalInsert = this.db.prepare("INSERT INTO desktop_processed_signal_keys (signal_key, ordinal) VALUES (?, ?)");
    processedSignalKeys.forEach((key, ordinal) => signalInsert.run(key, ordinal));
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { try { this.db.exec("ROLLBACK"); } catch { /* preserve original error */ } throw error; }
  }
}
