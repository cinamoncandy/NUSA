const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mobileSrc = path.resolve(__dirname, "../apps/mobile/src");
const credentialSource = fs.readFileSync(path.join(mobileSrc, "upbitCredentialSession.ts"), "utf8");
const clientSource = fs.readFileSync(path.join(mobileSrc, "upbitLiveClient.ts"), "utf8");
const { normalizeUpbitReadOnlySnapshot } = require("../dist/apps/mobile/src/upbitReadOnlyAccountModel.js");

test("Upbit bridge credential stays process-memory-only", () => {
  assert.match(credentialSource, /let sharedToken: string \| null = null/);
  assert.match(credentialSource, /credentialProvider/);
  assert.doesNotMatch(credentialSource, /AsyncStorage|SecureStorage|setItem\s*\(|writeFile|writeFileSync|UPBIT_ACCESS_KEY|UPBIT_SECRET_KEY/);
});

test("Upbit bridge is HTTPS-only and read-only", () => {
  assert.match(clientSource, /https:\/\/nusa-api\.duckdns\.org/);
  assert.match(clientSource, /url\.protocol !== "https:"/);
  assert.match(clientSource, /\/api\/v1\/account\/summary/);
  assert.match(clientSource, /method: "GET"/);
  assert.match(clientSource, /Authorization: "Bearer " \+ token/);
  assert.doesNotMatch(clientSource, /method: "POST"|method: "DELETE"|\/v1\/withdraws|placeLiveOrder|submitOrder|cancelOrder/);
  assert.match(clientSource, /loadUpbitLiveOrders/);
  assert.match(clientSource, /\/api\/v1\/orders\/open/);
  assert.match(clientSource, /\/api\/v1\/orders\/history/);
  assert.match(clientSource, /method: "GET"/);
});

test("Upbit normalized summary is validated fail-closed", () => {
  assert.match(clientSource, /\/api\/v1\/account\/summary/);
  assert.match(clientSource, /summary\.provider !== "UPBIT"/);
  assert.match(clientSource, /summary\.mode !== "READ_ONLY"/);
  assert.match(clientSource, /Number\.isFinite\(parsed\)/);
  assert.match(clientSource, /parsed < 0/);
  assert.match(clientSource, /Invalid Upbit account summary/);
  assert.match(clientSource, /Invalid Upbit/);
});

test("Upbit account snapshot normalizes cash and assets without mixing PAPER", () => {
  const snapshot = normalizeUpbitReadOnlySnapshot({
    accounts: [
      { currency: "KRW", balance: 100000, locked: 1200, avgBuyPrice: 0, unitCurrency: "KRW" },
      { currency: "BTC", balance: 0.25, locked: 0.01, avgBuyPrice: 90000000, unitCurrency: "KRW" },
    ],
    krwBalance: 100000,
    fetchedAt: 123,
  });
  assert.deepEqual(snapshot, {
    provider: "UPBIT",
    mode: "READ_ONLY",
    fetchedAt: 123,
    cash: { currency: "KRW", available: 100000, locked: 1200 },
    assets: [{ currency: "BTC", available: 0.25, locked: 0.01, avgBuyPrice: 90000000, unitCurrency: "KRW" }],
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /token|secret|access[_-]?key|bearer/i);
});

test("Upbit empty and zero balances remain a valid read-only snapshot", () => {
  const snapshot = normalizeUpbitReadOnlySnapshot({ accounts: [], krwBalance: 0, fetchedAt: 456 });
  assert.equal(snapshot.cash.available, 0);
  assert.equal(snapshot.cash.locked, 0);
  assert.deepEqual(snapshot.assets, []);
});

test("Portfolio exposes explicit disconnected/loading/ready/stale/error Upbit states", () => {
  const source = fs.readFileSync(path.join(mobileSrc, "upbitReadOnlyAccount.ts"), "utf8");
  const portfolio = fs.readFileSync(path.join(mobileSrc, "portfolioView.tsx"), "utf8");
  for (const status of ["DISCONNECTED", "LOADING", "READY", "STALE", "ERROR"]) assert.match(source, new RegExp(`"${status}"`));
  assert.match(portfolio, /REAL_READ_ONLY · REFERENCE/);
  assert.match(portfolio, /REAL_READ_ONLY 잔고는 감독용 기준선이며 PAPER 성과와 절대 합산하지 않습니다/);
  assert.doesNotMatch(portfolio, /주문하기|주문 실행|출금/);
});

test("Upbit projection is cleared with local session reset boundaries", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "apps", "mobile", "App.tsx"), "utf8");
  const settings = fs.readFileSync(path.join(mobileSrc, "settingsView.tsx"), "utf8");
  assert.match(app, /credentialSession\.clear\(\); clearPaperConnectionVerification\(\); resetUpbitReadOnlyState\(\)/);
  assert.match(settings, /clearPaperConnectionVerification\(\); resetUpbitReadOnlyState\(\)/);
});
