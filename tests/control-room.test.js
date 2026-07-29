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
const rendererSource = read("apps/desktop/renderer/renderer.js");

/**
 * Minimal DOM good enough for the control room, which only ever uses createElement,
 * createElementNS, textContent, className, classList, replaceChildren, append, and
 * addEventListener. No DOM library is added: this is ~50 lines and keeps the suite
 * dependency-free, matching how the other renderer tests in this repo work.
 */
function createStubDocument() {
  const makeNode = (tag, namespace) => {
    const node = {
      tagName: tag,
      namespace,
      children: [],
      attributes: {},
      listeners: {},
      _text: "",
      className: "",
      type: "",
      disabled: false,
      max: 0,
      value: 0,
      ownerDocument: null,
      get textContent() {
        return this.children.length ? this.children.map((child) => child.textContent).join("") : this._text;
      },
      set textContent(value) {
        this._text = String(value);
        this.children = [];
      },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name] ?? null; },
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = [...nodes]; },
      addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); },
      click() { for (const handler of this.listeners.click || []) handler(); }
    };
    return node;
  };
  const document = {
    createElement: (tag) => makeNode(tag, null),
    createElementNS: (ns, tag) => makeNode(tag, ns)
  };
  return document;
}

function loadControlRoom() {
  const windowStub = { confirm: () => true };
  const context = vm.createContext({ window: windowStub, document: createStubDocument(), console });
  context.globalThis = context;
  vm.runInContext(controlRoomSource, context);
  return { api: windowStub.DokkaebiControlRoom, document: context.document, windowStub };
}

const diagnostics = (overrides = {}) => ({
  state: "IDLE",
  sessionId: null,
  symbol: "KRW-BTC",
  strategyId: "sma-crossover",
  marketDataStatus: "WARMING_UP",
  closedCandleCount: 7,
  requiredWarmupCandles: 20,
  warmupComplete: false,
  lastClosedCandleTime: null,
  lastSignalTime: null,
  signalCount: 0,
  hypotheticalOrderCount: 0,
  hypotheticalFillCount: 0,
  actualBrokerCallCount: 0,
  actualOrderCount: 0,
  actualFillCount: 0,
  cashMutationCount: 0,
  positionMutationCount: 0,
  blockers: ["MARKET_DATA_WARMING_UP"],
  lastSignal: null,
  automaticResumeAllowed: false,
  productionMutationAllowed: false,
  ...overrides
});

function mount(overrides = {}) {
  const { api, document } = loadControlRoom();
  const root = document.createElement("section");
  const calls = [];
  const shadowPilot = {
    start: async () => { calls.push("start"); return diagnostics({ state: "RUNNING", sessionId: "shadow-1", blockers: [] }); },
    pause: async (id) => { calls.push(`pause:${id}`); return diagnostics({ state: "PAUSED", sessionId: id }); },
    resume: async (id) => { calls.push(`resume:${id}`); return diagnostics({ state: "RUNNING", sessionId: id, blockers: [] }); },
    stop: async (id) => { calls.push(`stop:${id}`); return diagnostics({ state: "COMPLETED", sessionId: id }); },
    status: async () => diagnostics(overrides.diagnostics || {}),
    ...overrides.shadowPilot
  };
  const panel = api.createControlRoom({ root, document, shadowPilot, confirm: overrides.confirm || (() => true) });
  return { api, panel, root, calls, shadowPilot };
}

const flatten = (node) => [node, ...node.children.flatMap(flatten)];
const textOf = (node) => flatten(node).map((child) => child._text).join(" ");
const classesOf = (node) => flatten(node).map((child) => child.className || child.getAttribute?.("class") || "").join(" ");
/** Select by label, never by index: a new unrelated button must not shift these lookups. */
const buttonNamed = (node, label) => flatten(node).find((child) => child.tagName === "button" && child._text === label);
const lifecycleButtons = (node) => ["관측 시작", "일시정지", "재개", "세션 종료"].map((label) => buttonNamed(node, label));

test("control room is mounted above the price hero and the chart", () => {
  // The core UX claim of the design: system state answers the first question, not price.
  const controlIndex = indexHtml.indexOf('id="control-room"');
  const heroIndex = indexHtml.indexOf('class="hero card"');
  const chartIndex = indexHtml.indexOf('id="chart"');
  assert.ok(controlIndex > 0, "control room section must exist");
  assert.ok(controlIndex < heroIndex, "control room must come before the price hero");
  assert.ok(controlIndex < chartIndex, "control room must come before the chart");
});

test("index.html loads the control room stylesheet and script", () => {
  assert.match(indexHtml, /href="control-room\.css"/);
  assert.match(indexHtml, /src="control-room\.js"/);
  assert.ok(indexHtml.indexOf("tokens.css") < indexHtml.indexOf("control-room.css"));
});

test("the A4P wordmark and symbol assets referenced by the header exist on disk", () => {
  assert.match(indexHtml, /assets\/dokkaebi-a4p-lockup\.svg/);
  assert.ok(fs.existsSync(path.join(root, "apps/desktop/renderer/assets/dokkaebi-a4p-lockup.svg")));
  assert.ok(fs.existsSync(path.join(root, "apps/desktop/renderer/assets/dokkaebi-a4p-symbol.svg")));
  // An <img> must carry a real alt; the brand mark is meaningful content in the header.
  assert.match(indexHtml, /alt="Dokkaebi Control Room"/);
});

test("control room never uses innerHTML or an inline style attribute", () => {
  // Both would break the app's strict `default-src 'self'; style-src 'self'` CSP.
  assert.doesNotMatch(controlRoomSource, /\.innerHTML\s*=/);
  assert.doesNotMatch(controlRoomSource, /\.style\./);
  assert.doesNotMatch(controlRoomSource, /setAttribute\(\s*["']style["']/);
});

test("control room never names a raw IPC channel or reaches the broker", () => {
  assert.doesNotMatch(controlRoomSource, /ipcRenderer|PaperBroker|shadow:start|shadow:stop|paper:order/);
});

test("all eight declared health states are reachable and styled", () => {
  const { api } = loadControlRoom();
  // Spread first: the array is constructed inside a vm context, so its prototype differs
  // from this realm's Array and a bare deepEqual would fail on identity, not on content.
  assert.deepEqual([...api.HEALTH], ["OFF", "CONNECTING", "WARMING_UP", "HEALTHY", "PAUSED", "WARNING", "HALTED", "EMERGENCY_STOP"]);
  for (const state of api.HEALTH) {
    assert.ok(api.HEALTH_LABEL[state], `${state} needs a Korean label`);
    assert.match(controlRoomCss, new RegExp(`\\.cr-flame--${state.toLowerCase().replace(/_/g, "-")}\\b`), `${state} needs a flame style`);
  }
});

test("every mode ring differs in stroke style, not only colour", () => {
  for (const mode of ["shadow", "canary", "paper", "extended"]) {
    assert.match(controlRoomCss, new RegExp(`\\.cr-flame--mode-${mode} \\.cr-flame__mode-ring`), `${mode} ring missing`);
  }
  // EXTENDED is dashed so the four modes stay distinguishable without colour vision.
  assert.match(controlRoomCss, /\.cr-flame--mode-extended \.cr-flame__mode-ring \{[^}]*stroke-dasharray/);
});

test("health derivation prefers the session's own condition over the feed's", () => {
  const { api } = loadControlRoom();
  assert.equal(api.deriveHealth(null, null), "OFF");
  assert.equal(api.deriveHealth(null, "HEALTHY"), "HEALTHY");
  // A paused or halted session must not read HEALTHY just because market data recovered.
  assert.equal(api.deriveHealth(diagnostics({ state: "PAUSED", marketDataStatus: "HEALTHY" })), "PAUSED");
  assert.equal(api.deriveHealth(diagnostics({ state: "HALTED", marketDataStatus: "HEALTHY" })), "HALTED");
  assert.equal(api.deriveHealth(diagnostics({ state: "FAILED", marketDataStatus: "HEALTHY" })), "HALTED");
  assert.equal(api.deriveHealth(diagnostics({ state: "RUNNING", marketDataStatus: "HEALTHY" })), "HEALTHY");
  assert.equal(api.deriveHealth(diagnostics({ state: "RUNNING", marketDataStatus: "STALE" })), "WARNING");
  assert.equal(api.deriveHealth(diagnostics({ state: "RUNNING", marketDataStatus: "GAP_DETECTED" })), "WARNING");
  // An idle, not-yet-warmed session is warming up, not healthy.
  assert.equal(api.deriveHealth(diagnostics({ state: "IDLE", marketDataStatus: "HEALTHY", warmupComplete: false })), "WARMING_UP");
});

test("blocker codes are translated rather than shown raw", () => {
  const { api } = loadControlRoom();
  assert.equal(api.describeBlocker("KILL_SWITCH_ACTIVE"), "Kill Switch가 켜져 있습니다");
  assert.match(api.describeBlocker("MARKET_DATA_WARMING_UP"), /예열/);
  assert.match(api.describeBlocker("MARKET_DATA_UNHEALTHY:STALE"), /STALE/);
  // An unknown code still surfaces rather than vanishing.
  assert.equal(api.describeBlocker("SOMETHING_NEW"), "SOMETHING_NEW");
});

test("the panel always states live-order and auto-resume capability in words", () => {
  const { panel, root } = mount();
  const text = textOf(root);
  assert.match(text, /실제 주문 불가/);
  assert.match(text, /자동 재개 불가/);
  assert.ok(panel.element === root);
});

test("warm-up shows a native progress element with real current/target values", async () => {
  const { panel, root } = mount();
  await panel.refresh();
  const progress = flatten(root).find((node) => node.tagName === "progress");
  assert.ok(progress, "warm-up must render a <progress>");
  assert.equal(progress.max, 20);
  assert.equal(progress.value, 7);
  assert.match(progress.getAttribute("aria-label"), /7 \/ 20/);
  assert.match(textOf(root), /7 \/ 20/);
});

test("actual-mutation counters are shown and read zero for a Shadow session", async () => {
  const { panel, root } = mount();
  await panel.refresh();
  const text = textOf(root);
  for (const label of ["실제 주문", "실제 체결", "현금 변동", "포지션 변동"]) assert.match(text, new RegExp(label));
  assert.match(classesOf(root), /cr-counter--zero/);
  assert.doesNotMatch(classesOf(root), /cr-counter--nonzero/);
});

test("completed-session history is shown separately from the current session", async () => {
  const history = [
    { sessionId: "shadow-1", completionReason: "MAX_SESSION_DURATION_REACHED", safety: "SAFE_COMPLETION" },
    { sessionId: "shadow-2", completionReason: "OWNER_STOPPED", safety: "SAFE_COMPLETION" }
  ];
  const { panel, root } = mount({ diagnostics: { completionHistory: history } });
  await panel.refresh();
  const text = textOf(root);
  assert.match(text, /Completion history/);
  assert.match(text, /shadow-1/);
  assert.match(text, /shadow-2/);
  assert.match(text, /MAX_SESSION_DURATION_REACHED/);
  assert.match(text, /OWNER_STOPPED/);
});

test("a non-zero actual mutation is styled as a violation, not as normal", async () => {
  const { panel, root } = mount({ diagnostics: { actualOrderCount: 1 } });
  await panel.refresh();
  assert.match(classesOf(root), /cr-counter--nonzero/);
});

test("lifecycle buttons are enabled strictly by the state that allows them", async () => {
  const cases = [
    ["IDLE", { start: false, pause: true, resume: true, stop: true }],
    ["RUNNING", { start: true, pause: false, resume: true, stop: false }],
    ["PAUSED", { start: true, pause: true, resume: false, stop: false }],
    ["HALTED", { start: true, pause: true, resume: true, stop: false }],
    ["COMPLETED", { start: true, pause: true, resume: true, stop: true }]
  ];
  for (const [state, expected] of cases) {
    const { panel, root } = mount({ diagnostics: { state } });
    await panel.refresh();
    const [start, pause, resume, stop] = lifecycleButtons(root);
    assert.equal(start.disabled, expected.start, `${state}: start`);
    assert.equal(pause.disabled, expected.pause, `${state}: pause`);
    assert.equal(resume.disabled, expected.resume, `${state}: resume`);
    assert.equal(stop.disabled, expected.stop, `${state}: stop`);
  }
});

test("resume and stop require an explicit confirmation; start does not", async () => {
  const declined = [];
  const { panel, root, calls } = mount({
    diagnostics: { state: "PAUSED", sessionId: "shadow-1" },
    confirm: (message) => { declined.push(message); return false; }
  });
  await panel.refresh();
  const [, , resume, stop] = lifecycleButtons(root);
  resume.click();
  stop.click();
  await Promise.resolve();
  assert.equal(calls.length, 0, "a declined confirmation must not call the bridge");
  assert.equal(declined.length, 2);
  assert.match(declined[0], /사전 점검이 다시 실행/);
  assert.match(declined[1], /다시 시작할 수 없습니다/);
});

test("a bridge failure surfaces as a visible reason instead of being swallowed", async () => {
  const { panel, root } = mount({
    diagnostics: { state: "IDLE" },
    shadowPilot: { start: async () => { throw new Error("precheck rejected"); } }
  });
  await panel.refresh();
  buttonNamed(root, "관측 시작").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(textOf(root), /precheck rejected/);
});

test("the panel degrades safely when the build exposes no Shadow bridge", () => {
  const { api, document } = loadControlRoom();
  const root = document.createElement("section");
  const panel = api.createControlRoom({ root, document, shadowPilot: null });
  assert.ok(lifecycleButtons(root).every((button) => button.disabled), "every control must be disabled");
  assert.match(textOf(root), /Shadow 제어를 사용할 수 없/);
  assert.ok(panel);
});

test("brand tokens are separate from the pre-existing semantic token families", () => {
  for (const token of ["--cr-ink-950", "--cr-teal-400", "--cr-violet-400", "--cr-amber-400", "--cr-red-400", "--cr-gold-400", "--cr-sky-400"]) {
    assert.match(tokensCss, new RegExp(`${token}:`), `${token} missing`);
  }
  // The original families must survive untouched; the brand layer is additive only.
  for (const token of ["--color-bg", "--font-sans", "--space-96", "--z-modal", "--breakpoint-lg"]) {
    assert.match(tokensCss, new RegExp(`${token}:`));
  }
  assert.match(tokensCss, /data-theme="contrast"/);
});

test("control room styles honour reduced motion", () => {
  assert.match(controlRoomCss, /prefers-reduced-motion: reduce/);
  assert.match(controlRoomCss, /\.cr-flame \{ animation: none/);
});

test("renderer mounts the control room and refreshes it on a timer", () => {
  assert.match(rendererSource, /DokkaebiControlRoom\.createControlRoom/);
  assert.match(rendererSource, /controlRoom\?\.setMarketStatus/);
  assert.match(rendererSource, /controlRoom\?\.setControlSnapshot/);
  assert.match(rendererSource, /clearTimeout\(controlRoomTimer\)/);
  assert.match(rendererSource, /beforeunload/);
});

const signalOutcome = (overrides = {}) => ({
  at: 1_320_000,
  signalType: "BUY",
  strategyReason: "short-SMA crossed above long-SMA",
  riskDecision: "REJECT",
  reasonCodes: ["RISK_GATE_NOT_CONFIGURED"],
  quantity: 0.001,
  price: 300,
  hypotheticalFill: false,
  ...overrides
});

test("pipeline reports every stage as not-called before any signal has flowed", () => {
  const { api } = loadControlRoom();
  const stages = api.derivePipeline(diagnostics({ lastSignal: null }));
  assert.equal(stages.length, 7);
  for (const stage of stages.slice(2)) assert.equal(stage.status, "NOT_CALLED", `${stage.key} must not claim a verdict`);
});

test("pipeline reflects the real market and warm-up state, not a hopeful one", () => {
  const { api } = loadControlRoom();
  const warming = api.derivePipeline(diagnostics({ marketDataStatus: "WARMING_UP", warmupComplete: false }));
  assert.equal(warming[0].status, "REJECT");
  assert.equal(warming[1].status, "WAITING");

  const healthy = api.derivePipeline(diagnostics({ marketDataStatus: "HEALTHY", warmupComplete: true }));
  assert.equal(healthy[0].status, "PASS");
  assert.equal(healthy[1].status, "PASS");

  const gone = api.derivePipeline(diagnostics({ marketDataStatus: "DISCONNECTED" }));
  assert.equal(gone[0].status, "HALT");
});

test("the broker stage is never anything but not-called in a Shadow session", () => {
  const { api } = loadControlRoom();
  for (const decision of ["ALLOW", "REJECT", "HALT"]) {
    const stages = api.derivePipeline(diagnostics({
      warmupComplete: true,
      marketDataStatus: "HEALTHY",
      lastSignal: signalOutcome({ riskDecision: decision, hypotheticalFill: decision === "ALLOW" })
    }));
    const broker = stages.find((stage) => stage.key === "broker");
    assert.equal(broker.status, "NOT_CALLED", `broker must stay uncalled on ${decision}`);
    // Portfolio is structurally skipped by Shadow's dispatch; claiming PASS would draw a
    // step that does not exist in this path.
    assert.equal(stages.find((stage) => stage.key === "portfolio").status, "NOT_CALLED");
  }
});

test("an allowed signal shows the execution gate as hypothetical, never as actual", () => {
  const { api } = loadControlRoom();
  const stages = api.derivePipeline(diagnostics({
    warmupComplete: true, marketDataStatus: "HEALTHY",
    lastSignal: signalOutcome({ riskDecision: "ALLOW", hypotheticalFill: true })
  }));
  assert.equal(stages.find((stage) => stage.key === "riskGateway").status, "ALLOW");
  assert.equal(stages.find((stage) => stage.key === "executionGate").status, "HYPOTHETICAL");
});

test("the risk gateway stage carries the real recorded decision", () => {
  const { api } = loadControlRoom();
  const stages = api.derivePipeline(diagnostics({ lastSignal: signalOutcome({ riskDecision: "HALT" }) }));
  assert.equal(stages.find((stage) => stage.key === "riskGateway").status, "HALT");
});

test("why panel separates the strategy verdict from the risk verdict", async () => {
  const { panel, root } = mount({ diagnostics: { lastSignal: signalOutcome() } });
  await panel.refresh();
  const text = textOf(root);
  assert.match(text, /매수 신호가 차단되었습니다/);
  assert.match(text, /전략 판단/);
  assert.match(text, /short-SMA crossed above long-SMA/);
  assert.match(text, /리스크 판단/);
  assert.match(text, /REJECT/);
  // The reason code is translated rather than dumped raw at the operator.
  assert.match(text, /차단 이유/);
});

test("why panel always states the four outcome counters", async () => {
  const { panel, root } = mount({ diagnostics: { lastSignal: signalOutcome() } });
  await panel.refresh();
  const text = textOf(root);
  for (const label of ["주문", "체결", "현금 변화", "포지션 변화"]) assert.match(text, new RegExp(label));
});

test("why panel is disabled, not fabricated, when no signal exists", async () => {
  const { panel, root } = mount({ diagnostics: { lastSignal: null } });
  await panel.refresh();
  const toggle = flatten(root).find((node) => node.className && node.className.includes("cr-why__toggle"));
  assert.ok(toggle, "why toggle must exist");
  assert.equal(toggle.disabled, true);
  assert.match(textOf(root), /설명할 신호가 아직 없습니다/);
});

test("why panel expands inline rather than as a modal", () => {
  // An inline expansion keeps the explanation next to the thing it explains, which a modal
  // would tear apart for a screen-reader user.
  assert.doesNotMatch(controlRoomSource, /role="dialog"|aria-modal/);
  assert.match(controlRoomSource, /aria-expanded/);
  assert.match(controlRoomSource, /aria-controls/);
});

test("pipeline explains why two stages read not-called instead of leaving it ambiguous", async () => {
  const { panel, root } = mount({ diagnostics: { lastSignal: signalOutcome() } });
  await panel.refresh();
  assert.match(textOf(root), /포트폴리오 점검과 브로커 호출 단계를 원래 거치지 않습니다/);
});
