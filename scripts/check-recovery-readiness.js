#!/usr/bin/env node
"use strict";
/**
 * Offline recovery-reconciliation preview (WO-0034-A4I).
 *
 * Before this, the only way to find out what the recovery reconciliation would say was to
 * launch the Electron app and press the button. That is the same problem the A4 observation
 * had: you cannot rehearse it, you cannot see it in CI, and when it blocks you learn the
 * reason and the fact that it blocked at the same moment.
 *
 * This reads the app's own saved state and runs `compareRecoveryState` -- the SAME function
 * the running app calls. A second, separate implementation would be worse than nothing: it
 * could report MATCHED for a state the app would refuse, which is exactly the kind of
 * reassurance that gets acted on.
 *
 * What it cannot do, and says so rather than guessing:
 *
 *   - It cannot approve anything. There is no flag, no argument and no code path here that
 *     records an owner decision. Approval requires a human clicking in the app, and putting
 *     a way to do it from a terminal here would defeat the review it exists to enforce.
 *   - It cannot see live market data, so the mark price is unknown to it. It says so and
 *     reports MARK_PRICE_UNAVAILABLE rather than substituting a number, because a cash and
 *     position comparison against an invented price is not a comparison.
 *   - It opens the database READ-ONLY. It cannot alter, repair or delete anything.
 *
 * Usage:
 *   node scripts/check-recovery-readiness.js [--user-data <path>] [--mark-price <n>] [--json]
 *
 * With no --user-data the platform's default Electron userData location for this app is used.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_NAME = "dokkaebi";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const name = token.slice(2);
    if (name === "json") { args.json = true; continue; }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} requires a value`);
    args[name] = value;
    index += 1;
  }
  return args;
}

/** Mirrors Electron's own app.getPath("userData") for each platform. */
function defaultUserDataDirectory() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error("APPDATA is not set; pass --user-data explicitly");
    return path.join(appData, APP_NAME);
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", APP_NAME);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), APP_NAME);
}

/**
 * Scans for evidence archives with no completion marker. Duplicated from the archive module
 * only in the sense that it is the same rule; it is read-only and cannot create a directory,
 * so it never invents the state it is reporting on.
 */
function findMarkerlessArchives(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => {
        const files = new Set(fs.readdirSync(path.join(root, entry.name)));
        return !files.has("completed.marker") && !files.has("aborted.marker");
      })
      .map((entry) => entry.name);
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
}

/** Plain-Korean guidance keyed by the code, so an operator is not left to interpret a token. */
const CODE_HELP = {
  PENDING_ORDERS: "체결 시각이 아직 확정되지 않은 주문이 있습니다. 앱을 켜서 주문 상태를 확인하세요.",
  UNRESOLVED_FILLS: "체결 기록이 없는 주문이 있습니다. 앱에서 체결 기록을 확인하세요.",
  ORPHAN_ORDERS: "식별 번호가 없는 주문이 있습니다. 데이터가 손상됐을 수 있습니다.",
  CASH_MISMATCH: "장부에서 계산한 현금과 계좌에 적힌 현금이 다릅니다.",
  POSITION_MISMATCH: "장부에서 계산한 보유 수량과 계좌에 적힌 수량이 다릅니다.",
  LEDGER_INCONSISTENT: "거래 장부 자체가 앞뒤가 맞지 않습니다.",
  BROKER_MUTATION: "실제 거래 호출이 기록돼 있습니다. Shadow는 아무것도 바꾸지 않아야 합니다.",
  ORDER_MUTATION: "실제 주문이 기록돼 있습니다.",
  FILL_MUTATION: "실제 체결이 기록돼 있습니다.",
  CASH_MUTATION: "현금이 변경된 기록이 있습니다.",
  POSITION_MUTATION: "보유 수량이 변경된 기록이 있습니다.",
  KILL_SWITCH_ACTIVE: "킬스위치가 켜져 있습니다. 먼저 해제해야 합니다.",
  UNRESOLVED_P0_ALERT: "해결되지 않은 최우선 경보가 있습니다. 먼저 처리하세요.",
  MARKERLESS_EVIDENCE: "봉인되지 않은 기록 폴더가 있습니다. 지우지 말고 다른 곳으로 옮기세요.",
  PRIVATE_API_CAPABILITY_PRESENT: "인증이 필요한 거래소 기능이 탐지됐습니다.",
  CREDENTIAL_CAPABILITY_PRESENT: "자격증명 저장 기능이 탐지됐습니다.",
  RECOVERY_RECORD_MISSING: "복구할 기록이 없습니다. 정산할 대상 자체가 없다는 뜻입니다.",
  PERSISTED_SNAPSHOT_MISSING: "저장된 안전 스냅샷이 없습니다. 앱을 한 번도 정상 종료한 적이 없을 수 있습니다.",
  ACCOUNT_STATE_UNREADABLE: "계좌 상태를 읽지 못했습니다.",
  MARK_PRICE_UNAVAILABLE: "기준 시세를 알 수 없습니다. 이 도구는 시세를 받지 않으므로, 금액 비교는 앱에서 확인해야 합니다.",
  PERSISTENCE_UNHEALTHY: "저장소를 정상적으로 열지 못했습니다.",
  COMPARISON_THREW: "비교 도중 오류가 났습니다."
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  const userData = args["user-data"] === undefined ? defaultUserDataDirectory() : path.resolve(args["user-data"]);
  const markPrice = args["mark-price"] === undefined ? null : Number(args["mark-price"]);
  if (markPrice !== null && (!Number.isFinite(markPrice) || markPrice <= 0)) throw new Error("--mark-price must be a positive number");

  const { compareRecoveryState } = require("../dist/apps/desktop/src/recoveryReconciliation.js");
  const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
  const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/desktopPersistenceStore.js");

  // These mirror main.ts's own constants. If they ever drift, the comparison below is
  // measuring a different account than the app does, so they are asserted in a test.
  const INITIAL_CASH = 10_000_000;
  const MARKET = "KRW-BTC";
  const FEE_RATE = 0.0005;
  const RISK_POLICY = { maxOrderNotional: 2_000_000, maxPositionQuantity: 0.1, maxRealizedLoss: 1_000_000, minOrderNotional: 5_000 };
  const FILL_MODEL = { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 };

  const databasePath = path.join(userData, "dokkaebi.db");
  const notes = [];
  let store = null;
  let snapshot = null;
  let broker = null;
  let persistenceHealthy = false;

  if (!fs.existsSync(databasePath)) {
    notes.push("저장소 파일이 없습니다. 앱을 아직 실행한 적이 없거나, 다른 폴더를 보고 있습니다.");
  } else {
    try {
      // Read-only: this tool cannot alter, repair or delete anything it inspects.
      store = new DesktopPersistenceStore(databasePath, { readOnly: true });
      persistenceHealthy = true;
      try {
        snapshot = store.loadPaperSafetySnapshot() ?? null;
      } catch (error) {
        notes.push(`안전 스냅샷을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
      }
      const state = store.load();
      if (state && state.paper) broker = new PaperBroker(INITIAL_CASH, MARKET, FEE_RATE, RISK_POLICY, state.paper, FILL_MODEL);
      else notes.push("저장된 계좌 상태가 없습니다.");
    } catch (error) {
      notes.push(`저장소를 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (store) { try { store.close(); } catch { /* read-only handle; nothing to roll back */ } }
    }
  }

  if (markPrice === null) notes.push("기준 시세가 없어 금액·수량 비교는 수행되지 않았습니다. --mark-price 로 현재 시세를 주면 그 부분까지 미리 볼 수 있습니다.");

  const comparison = compareRecoveryState({
    recoveryRecordId: snapshot ? snapshot.snapshotId : null,
    persistedSnapshotPresent: snapshot !== null,
    persistenceHealthy,
    broker,
    initialCash: INITIAL_CASH,
    markPrice,
    killSwitchActive: snapshot ? snapshot.killSwitch.active : false,
    openP0Codes: snapshot ? snapshot.openAlerts.filter((alert) => alert.severity === "P0" && alert.status !== "RESOLVED").map((alert) => alert.reasonCode) : [],
    markerlessEvidence: findMarkerlessArchives(path.join(userData, "shadow-evidence")),
    // This process composes no such path. Reported as measured state, not as proof none
    // could exist -- the app's own scan is the authority for the session it runs.
    authenticatedEndpointCapabilityPresent: false,
    credentialStorageCapabilityPresent: false,
    mutationCounters: { broker: 0, orders: 0, fills: 0, cash: 0, position: 0 },
    checkedAt: Date.now()
  });

  if (args.json) {
    console.log(JSON.stringify({ comparison, notes, markPriceSupplied: markPrice !== null }, null, 2));
  } else {
    console.log("[복구 정산 미리보기 — 읽기 전용]");
    console.log("");
    console.log(`대조 결과: ${comparison.outcome}`);
    console.log(`복구 기록 번호: ${comparison.recoveryRecordId ?? "없음"}`);
    console.log(`대조 지문: ${comparison.fingerprint.slice(0, 12)}…`);
    if (comparison.mismatchCodes.length > 0) {
      console.log("");
      console.log("막고 있는 항목:");
      for (const code of comparison.mismatchCodes) console.log(`  - ${code}: ${CODE_HELP[code] ?? "(설명 없음)"}`);
    }
    if (comparison.errorCodes.length > 0) {
      console.log("");
      console.log("대조를 못 한 이유:");
      for (const code of comparison.errorCodes) console.log(`  - ${code}: ${CODE_HELP[code] ?? "(설명 없음)"}`);
    }
    if (notes.length > 0) {
      console.log("");
      console.log("참고:");
      for (const note of notes) console.log(`  - ${note}`);
    }
    console.log("");
    console.log("이 도구는 아무것도 승인하지 않고, 아무것도 바꾸지 않습니다.");
    console.log("승인은 앱 화면에서 직접 눌러야만 됩니다.");
  }

  // A non-MATCHED preview is not a script failure: it is the answer. Exit 0 either way, so a
  // shell that stops on error does not hide the very report the operator asked for.
}

try {
  main();
} catch (error) {
  console.error(`[복구 정산 미리보기] 실행 실패: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
