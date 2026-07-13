import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { runMigrations } from "../../../packages/storage/src/migrationRunner";
import type { ControlPlaneState } from "./controlPlane";
import type { PaperBrokerState, PaperOrder } from "./paperBroker";
import type { PaperScenarioEvent } from "../../cloud/src/paperScenarioEvidenceLedger";

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
    try { runMigrations(this.db, migrations); }
    catch (error) { this.db.close(); throw error; }
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
    this.transaction(() => {
      this.write({ paper, control });
      const next = Number((this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM desktop_paper_scenario_evidence").get() as { sequence: number }).sequence) + 1;
      this.db.prepare("INSERT INTO desktop_paper_scenario_evidence (sequence, event_id, event_json) VALUES (?, ?, ?)").run(next, event.eventId, JSON.stringify(event));
    });
  }

  close(): void { this.db.close(); }

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

