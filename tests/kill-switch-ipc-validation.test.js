const test = require("node:test");
const assert = require("node:assert/strict");
const { parseKillSwitchReleaseIpc, parseKillSwitchActivateIpc } = require("../dist/apps/desktop/src/ipc/killSwitchIpcValidation.js");

test("parseKillSwitchReleaseIpc requires the exact confirmation phrase", () => {
  assert.throws(() => parseKillSwitchReleaseIpc({ confirmationText: "paper trading enable", reason: "test" }), /confirmation phrase/);
  assert.throws(() => parseKillSwitchReleaseIpc({ confirmationText: "PAPER TRADING ENABLE ", reason: "test" }), /confirmation phrase/);
  assert.throws(() => parseKillSwitchReleaseIpc({ confirmationText: "confirmed", reason: "test" }), /confirmation phrase/);
  assert.throws(() => parseKillSwitchReleaseIpc({ confirmationText: true, reason: "test" }), /confirmation phrase/);
  const parsed = parseKillSwitchReleaseIpc({ confirmationText: "PAPER TRADING ENABLE", reason: "operator verified market data" });
  assert.equal(parsed.confirmationText, "PAPER TRADING ENABLE");
  assert.equal(parsed.reason, "operator verified market data");
});

test("parseKillSwitchReleaseIpc rejects extra fields and missing/blank reasons", () => {
  assert.throws(() => parseKillSwitchReleaseIpc({ confirmationText: "PAPER TRADING ENABLE", reason: "test", extra: 1 }), /invalid/);
  assert.throws(() => parseKillSwitchReleaseIpc({ confirmationText: "PAPER TRADING ENABLE", reason: "" }), /invalid/);
  assert.throws(() => parseKillSwitchReleaseIpc({ confirmationText: "PAPER TRADING ENABLE", reason: "   " }), /invalid/);
  assert.throws(() => parseKillSwitchReleaseIpc({ confirmationText: "PAPER TRADING ENABLE" }), /invalid/);
  assert.throws(() => parseKillSwitchReleaseIpc(null), /invalid/);
  assert.throws(() => parseKillSwitchReleaseIpc("PAPER TRADING ENABLE"), /invalid/);
});

test("parseKillSwitchActivateIpc requires only a non-blank reason, no confirmation phrase", () => {
  const parsed = parseKillSwitchActivateIpc({ reason: "operator re-armed after review" });
  assert.equal(parsed.reason, "operator re-armed after review");
  assert.throws(() => parseKillSwitchActivateIpc({ reason: "" }), /invalid/);
  assert.throws(() => parseKillSwitchActivateIpc({}), /invalid/);
  assert.throws(() => parseKillSwitchActivateIpc({ reason: "ok", confirmationText: "PAPER TRADING ENABLE" }), /invalid/);
});
