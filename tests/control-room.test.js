const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const controlRoomSource = read("apps/desktop/renderer/control-room.js");
const controlRoomCss = read("apps/desktop/renderer/control-room.css");
const indexHtml = read("apps/desktop/renderer/index.html");
const tokensCss = read("apps/desktop/renderer/tokens.css");

function createStubDocument() {
  const makeNode = (tag, namespace) => ({
    tagName: tag, namespace, children: [], attributes: {}, listeners: {}, _text: "", className: "", type: "", disabled: false, max: 0, value: 0,
    get textContent() { return this.children.length ? this.children.map((child) => child.textContent).join("") : this._text; },
    set textContent(value) { this._text = String(value); this.children = []; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); },
    click() { for (const handler of this.listeners.click || []) handler(); }
  });
  return { createElement: (tag) => makeNode(tag, null), createElementNS: (ns, tag) => makeNode(tag, ns) };
}

function loadControlRoom() {
  const windowStub = { confirm: () => true };
  const context = vm.createContext({ window: windowStub, document: createStubDocument(), console });
  context.globalThis = context;
  vm.runInContext(controlRoomSource, context);
  return { api: windowStub.NUSAControlRoom, document: context.document };
}

const diagnostics = (overrides = {}) => ({
  state: "IDLE", sessionId: null, symbol: "KRW-BTC", strategyId: "sma-crossover",
  marketDataStatus: "WARMING_UP", closedCandleCount: 7, requiredWarmupCandles: 20,
  warmupComplete: false, signalCount: 0, hypotheticalOrderCount: 0, hypotheticalFillCount: 0,
  actualBrokerCallCount: 0, actualOrderCount: 0, actualFillCount: 0, cashMutationCount: 0,
  positionMutationCount: 0, blockers: ["MARKET_DATA_WARMING_UP"], lastSignal: null,
  automaticResumeAllowed: false, productionMutationAllowed: false, ...overrides
});

function mount(overrides = {}) {
  const { api, document } = loadControlRoom();
  const rootNode = document.createElement("section");
  const calls = [];
  const shadowPilot = {
    start: async () => { calls.push("start"); return diagnostics({ state: "RUNNING", sessionId: "shadow-1", blockers: [] }); },
    pause: async (id) => { calls.push(`pause:${id}`); return diagnostics({ state: "PAUSED", sessionId: id }); },
    resume: async (id) => { calls.push(`resume:${id}`); return diagnostics({ state: "RUNNING", sessionId: id, blockers: [] }); },
    stop: async (id) => { calls.push(`stop:${id}`); return diagnostics({ state: "COMPLETED", sessionId: id }); },
    status: async () => diagnostics(overrides.diagnostics || {}),
    ...overrides.shadowPilot
  };
  const panel = api.createControlRoom({ root: rootNode, document, shadowPilot, confirm: overrides.confirm || (() => true) });
  return { api, panel, root: rootNode, calls };
}

const flatten = (node) => [node, ...node.children.flatMap(flatten)];
const textOf = (node) => flatten(node).map((child) => child._text).join(" ");
const classesOf = (node) => flatten(node).map((child) => child.className || child.getAttribute?.("class") || "").join(" ");
const buttonNamed = (node, label) => flatten(node).find((child) => child.tagName === "button" && child._text === label);

test("canonical renderer retires the historical control room from active hierarchy", () => {
  assert.doesNotMatch(indexHtml, /id="control-room"/);
  assert.doesNotMatch(indexHtml, /href="control-room\.css"|src="control-room\.js"/);
  assert.match(indexHtml, /data-simple-page="dashboard"/);
  assert.match(indexHtml, /data-simple-page="strategy"/);
  assert.match(indexHtml, /PAPER · 실거래 비활성/);
});

test("canonical brand uses the current NUSA symbol asset", () => {
  assert.match(indexHtml, /assets\/nusa-a4p-symbol\.svg/);
  assert.ok(fs.existsSync(path.join(root, "apps/desktop/renderer/assets/nusa-a4p-symbol.svg")));
  assert.match(indexHtml, /alt="NUSA"/);
});

test("historical control room remains presentation-only and CSP safe", () => {
  assert.doesNotMatch(controlRoomSource, /\.innerHTML\s*=|\.style\.|setAttribute\(\s*["']style["']/);
  assert.doesNotMatch(controlRoomSource, /ipcRenderer|PaperBroker|shadow:start|shadow:stop|paper:order/);
});

test("historical health state model remains complete and non-colour-only", () => {
  const { api } = loadControlRoom();
  assert.deepEqual([...api.HEALTH], ["OFF", "CONNECTING", "WARMING_UP", "HEALTHY", "PAUSED", "WARNING", "HALTED", "EMERGENCY_STOP"]);
  for (const state of api.HEALTH) {
    assert.ok(api.HEALTH_LABEL[state]);
    assert.match(controlRoomCss, new RegExp(`\\.cr-flame--${state.toLowerCase().replace(/_/g, "-")}\\b`));
  }
  assert.match(controlRoomCss, /\.cr-flame--mode-extended \.cr-flame__mode-ring \{[^}]*stroke-dasharray/);
});

test("historical health derivation remains fail-closed", () => {
  const { api } = loadControlRoom();
  assert.equal(api.deriveHealth(null, null), "OFF");
  assert.equal(api.deriveHealth(diagnostics({ state: "PAUSED", marketDataStatus: "HEALTHY" })), "PAUSED");
  assert.equal(api.deriveHealth(diagnostics({ state: "HALTED", marketDataStatus: "HEALTHY" })), "HALTED");
  assert.equal(api.deriveHealth(diagnostics({ state: "FAILED", marketDataStatus: "HEALTHY" })), "HALTED");
  assert.equal(api.deriveHealth(diagnostics({ state: "RUNNING", marketDataStatus: "STALE" })), "WARNING");
});

test("blocker codes remain operator-readable", () => {
  const { api } = loadControlRoom();
  assert.equal(api.describeBlocker("KILL_SWITCH_ACTIVE"), "Kill Switch가 켜져 있습니다");
  assert.match(api.describeBlocker("MARKET_DATA_WARMING_UP"), /예열/);
  assert.equal(api.describeBlocker("SOMETHING_NEW"), "SOMETHING_NEW");
});

test("historical panel states zero authority in words", async () => {
  const { panel, root: rootNode } = mount();
  await panel.refresh();
  const text = textOf(rootNode);
  assert.match(text, /실제 주문 불가/);
  assert.match(text, /자동 재개 불가/);
  assert.match(classesOf(rootNode), /cr-counter--zero/);
});

test("warm-up still exposes native progress with real current and target", async () => {
  const { panel, root: rootNode } = mount();
  await panel.refresh();
  const progress = flatten(rootNode).find((node) => node.tagName === "progress");
  assert.ok(progress);
  assert.equal(progress.max, 20);
  assert.equal(progress.value, 7);
});

test("non-zero actual mutation is rendered as a violation", async () => {
  const { panel, root: rootNode } = mount({ diagnostics: { actualOrderCount: 1 } });
  await panel.refresh();
  assert.match(classesOf(rootNode), /cr-counter--nonzero/);
});

test("historical lifecycle control permissions stay state-specific", async () => {
  const { panel, root: rootNode } = mount({ diagnostics: { state: "PAUSED", sessionId: "shadow-1" } });
  await panel.refresh();
  assert.equal(buttonNamed(rootNode, "관측 시작").disabled, true);
  assert.equal(buttonNamed(rootNode, "일시정지").disabled, true);
  assert.equal(buttonNamed(rootNode, "재개").disabled, false);
  assert.equal(buttonNamed(rootNode, "세션 종료").disabled, false);
});

test("resume and stop remain explicit-confirmation actions", async () => {
  const prompts = [];
  const { panel, root: rootNode, calls } = mount({ diagnostics: { state: "PAUSED", sessionId: "shadow-1" }, confirm: (message) => { prompts.push(message); return false; } });
  await panel.refresh();
  buttonNamed(rootNode, "재개").click();
  buttonNamed(rootNode, "세션 종료").click();
  await Promise.resolve();
  assert.deepEqual(calls, []);
  assert.equal(prompts.length, 2);
});

test("missing Shadow bridge disables every historical lifecycle control", () => {
  const { api, document } = loadControlRoom();
  const rootNode = document.createElement("section");
  api.createControlRoom({ root: rootNode, document, shadowPilot: null });
  for (const label of ["관측 시작", "일시정지", "재개", "세션 종료"]) assert.equal(buttonNamed(rootNode, label).disabled, true);
  assert.match(textOf(rootNode), /Shadow 제어를 사용할 수 없/);
});

test("brand tokens remain additive and contrast-aware", () => {
  for (const token of ["--cr-ink-950", "--cr-teal-400", "--cr-violet-400", "--cr-amber-400", "--cr-red-400"]) assert.match(tokensCss, new RegExp(`${token}:`));
  for (const token of ["--color-bg", "--font-sans", "--z-modal"]) assert.match(tokensCss, new RegExp(`${token}:`));
  assert.match(tokensCss, /data-theme="contrast"/);
  assert.match(controlRoomCss, /prefers-reduced-motion: reduce/);
});

const signalOutcome = (overrides = {}) => ({
  at: 1320000, signalType: "BUY", strategyReason: "short-SMA crossed above long-SMA",
  riskDecision: "REJECT", reasonCodes: ["RISK_GATE_NOT_CONFIGURED"], quantity: 0.001,
  price: 300, hypotheticalFill: false, ...overrides
});

test("historical decision pipeline never claims skipped broker execution", () => {
  const { api } = loadControlRoom();
  const stages = api.derivePipeline(diagnostics({ warmupComplete: true, marketDataStatus: "HEALTHY", lastSignal: signalOutcome({ riskDecision: "ALLOW", hypotheticalFill: true }) }));
  assert.equal(stages.find((stage) => stage.key === "riskGateway").status, "ALLOW");
  assert.equal(stages.find((stage) => stage.key === "executionGate").status, "HYPOTHETICAL");
  assert.equal(stages.find((stage) => stage.key === "broker").status, "NOT_CALLED");
  assert.equal(stages.find((stage) => stage.key === "portfolio").status, "NOT_CALLED");
});

test("historical why panel separates strategy and risk verdicts without fabrication", async () => {
  const { panel, root: rootNode } = mount({ diagnostics: { lastSignal: signalOutcome() } });
  await panel.refresh();
  const text = textOf(rootNode);
  assert.match(text, /전략 판단/);
  assert.match(text, /short-SMA crossed above long-SMA/);
  assert.match(text, /리스크 판단/);
  assert.match(text, /REJECT/);
  assert.match(controlRoomSource, /aria-expanded/);
  assert.doesNotMatch(controlRoomSource, /role="dialog"|aria-modal/);
});
