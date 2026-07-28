/*
 * DOKKAEBI Control Room — status-first renderer layer.
 *
 * Answers "what is the system doing right now" above the fold, before any chart. It owns
 * no trading logic: it reads the Shadow diagnostics snapshot and the control/market
 * callbacks the preload bridge already exposes, and renders them.
 *
 * Constraints this file deliberately honours:
 *   - No innerHTML anywhere; every node is built with createElement/replaceChildren.
 *   - No inline style attributes and no CSSOM writes, so the strict `style-src 'self'` CSP
 *     needs no relaxing. Progress is a native <progress>, which also announces itself to a
 *     screen reader without extra ARIA.
 *   - No raw IPC channel names. It only calls the fixed methods on the preload bridge.
 */
(function initialiseControlRoom(globalScope) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  /** Health states, in the order the design system defines them. */
  const HEALTH = ["OFF", "CONNECTING", "WARMING_UP", "HEALTHY", "PAUSED", "WARNING", "HALTED", "EMERGENCY_STOP"];

  const HEALTH_LABEL = {
    OFF: "꺼짐",
    CONNECTING: "연결 중",
    WARMING_UP: "예열 중",
    HEALTHY: "정상",
    PAUSED: "일시정지",
    WARNING: "경고",
    HALTED: "정지됨",
    EMERGENCY_STOP: "긴급 정지"
  };

  /**
   * Market-data status -> flame health. Shadow's lifecycle state wins over this when the
   * session itself is paused or halted, because an operator needs to see the session's
   * condition, not just the feed's.
   */
  const MARKET_TO_HEALTH = {
    CONNECTING: "CONNECTING",
    WARMING_UP: "WARMING_UP",
    HEALTHY: "HEALTHY",
    STALE: "WARNING",
    RECONNECTING: "WARNING",
    GAP_DETECTED: "WARNING",
    OUT_OF_ORDER: "WARNING",
    CLOCK_DRIFT: "WARNING",
    DISCONNECTED: "OFF"
  };

  const MARKET_LABEL = {
    CONNECTING: "연결 중",
    WARMING_UP: "예열 중",
    HEALTHY: "정상",
    STALE: "지연",
    RECONNECTING: "재연결 중",
    GAP_DETECTED: "구간 누락",
    OUT_OF_ORDER: "순서 역전",
    CLOCK_DRIFT: "시계 오차",
    DISCONNECTED: "연결 끊김"
  };

  /** Blocker reason code -> plain Korean, so an operator needn't read the code itself. */
  const BLOCKER_LABEL = {
    MARKET_DATA_DISCONNECTED: "시장 데이터가 연결되지 않았습니다",
    MARKET_DATA_WARMING_UP: "예열이 끝나지 않았습니다 (closed candle 20개 필요)",
    KILL_SWITCH_ACTIVE: "Kill Switch가 켜져 있습니다",
    OPEN_P0_ALERT: "해결되지 않은 P0 경보가 있습니다",
    DEPLOYMENT_INTEGRITY_FAILED: "배포 무결성이 확인되지 않았습니다",
    RECONCILIATION_REQUIRED: "정합성 확인(reconciliation)이 필요합니다",
    AUTOMATIC_TRADING_ON: "Paper 자동매매가 켜져 있습니다 (Shadow와 동시 실행 불가)",
    CANARY_OR_EXTENDED_MODE_ACTIVE: "Canary/Extended 모드가 실행 중입니다",
    OWNER_REQUESTED_PAUSE: "운영자가 직접 일시정지했습니다",
    MARKET_DATA_STALE: "시장 데이터가 지연되고 있습니다",
    MARKET_DATA_RECONNECTING: "시장 데이터가 재연결 중입니다",
    MARKET_DATA_GAP_DETECTED: "캔들 구간 누락이 감지되었습니다",
    MARKET_DATA_OUT_OF_ORDER: "캔들 순서 역전이 감지되었습니다",
    MARKET_DATA_CLOCK_DRIFT: "시계 오차가 허용 범위를 넘었습니다",
    MARKET_DATA_DISCONNECTED_EXHAUSTED: "재연결 시도가 모두 실패했습니다",
    MARKET_DATA_DEGRADED: "시장 데이터 품질이 저하되었습니다"
  };

  const describeBlocker = (code) => BLOCKER_LABEL[code] || (code.startsWith("MARKET_DATA_UNHEALTHY:")
    ? `시장 데이터 상태가 정상이 아닙니다 (${code.slice("MARKET_DATA_UNHEALTHY:".length)})`
    : code);

  /** Pipeline stage presentation. NOT_CALLED is not a failure and must not read as one. */
  const STAGE_TONE = {
    PASS: { tone: "ok", glyph: "✔", label: "PASS" },
    REJECT: { tone: "bad", glyph: "✕", label: "REJECT" },
    HALT: { tone: "bad", glyph: "■", label: "HALT" },
    NOT_CALLED: { tone: "neutral dashed", glyph: "○", label: "호출 안 됨" },
    HYPOTHETICAL: { tone: "shadow dashed", glyph: "◈", label: "가상" },
    ACTUAL_PAPER: { tone: "ok", glyph: "✔", label: "실제 Paper" },
    WAITING: { tone: "warn", glyph: "◔", label: "대기" }
  };

  const STAGES = [
    { key: "marketData", name: "시장 데이터" },
    { key: "closedCandle", name: "종가 캔들" },
    { key: "strategy", name: "전략" },
    { key: "portfolio", name: "포트폴리오" },
    { key: "riskGateway", name: "Risk Gateway" },
    { key: "executionGate", name: "실행 게이트" },
    { key: "broker", name: "브로커" }
  ];

  /**
   * Derives each pipeline stage from what actually happened, never from what would be
   * reassuring. Two stages are structurally NOT_CALLED in a Shadow session and say so:
   * Shadow's dispatch runs no portfolio check, and it never reaches a broker at all. Marking
   * either of them PASS would draw a step that does not exist in this path.
   */
  function derivePipeline(diagnostics) {
    if (!diagnostics) return STAGES.map((stage) => ({ ...stage, status: "NOT_CALLED" }));
    const marketStatus = diagnostics.marketDataStatus;
    const market = marketStatus === "HEALTHY" ? "PASS" : marketStatus === "DISCONNECTED" ? "HALT" : "REJECT";
    const candle = diagnostics.warmupComplete ? "PASS" : "WAITING";
    const signal = diagnostics.lastSignal || null;
    const risk = signal ? signal.riskDecision : "NOT_CALLED";
    const status = {
      marketData: market,
      closedCandle: candle,
      strategy: signal ? "PASS" : "NOT_CALLED",
      portfolio: "NOT_CALLED",
      riskGateway: risk,
      executionGate: signal && signal.hypotheticalFill ? "HYPOTHETICAL" : "NOT_CALLED",
      broker: "NOT_CALLED"
    };
    return STAGES.map((stage) => ({ ...stage, status: status[stage.key] }));
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /**
   * Badge = colour + glyph + text, always all three. The glyph is aria-hidden because the
   * text already carries the same meaning; announcing "check mark 정상" twice is noise.
   */
  function badge(tone, glyph, text) {
    const node = element("span", `cr-badge cr-badge--${tone}`);
    const mark = element("span", "cr-badge__glyph", glyph);
    mark.setAttribute("aria-hidden", "true");
    node.append(mark, element("span", null, text));
    return node;
  }

  function buildFlame(document_) {
    const svg = document_.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 64 64");
    svg.setAttribute("class", "cr-flame");
    svg.setAttribute("role", "img");

    const defs = document_.createElementNS(SVG_NS, "defs");
    const gradient = document_.createElementNS(SVG_NS, "linearGradient");
    gradient.setAttribute("id", "cr-flame-gradient");
    gradient.setAttribute("x1", "0");
    gradient.setAttribute("y1", "0");
    gradient.setAttribute("x2", "0");
    gradient.setAttribute("y2", "1");
    for (const [offset, klass] of [["0", "cr-flame__stop-a"], ["0.55", "cr-flame__stop-b"], ["1", "cr-flame__stop-c"]]) {
      const stop = document_.createElementNS(SVG_NS, "stop");
      stop.setAttribute("offset", offset);
      stop.setAttribute("class", klass);
      gradient.append(stop);
    }
    defs.append(gradient);

    const modeRing = document_.createElementNS(SVG_NS, "circle");
    modeRing.setAttribute("class", "cr-flame__mode-ring");
    modeRing.setAttribute("cx", "32");
    modeRing.setAttribute("cy", "32");
    modeRing.setAttribute("r", "30.5");

    const ring = document_.createElementNS(SVG_NS, "circle");
    ring.setAttribute("class", "cr-flame__ring");
    ring.setAttribute("cx", "32");
    ring.setAttribute("cy", "32");
    ring.setAttribute("r", "27.5");

    const tick = document_.createElementNS(SVG_NS, "rect");
    tick.setAttribute("class", "cr-flame__tick");
    tick.setAttribute("x", "30.6");
    tick.setAttribute("y", "3");
    tick.setAttribute("width", "2.8");
    tick.setAttribute("height", "7");
    tick.setAttribute("rx", "1");

    const body = document_.createElementNS(SVG_NS, "path");
    body.setAttribute("class", "cr-flame__body");
    body.setAttribute("d", "M32 11.5 C 41 20.5, 47 29, 44.5 38.5 C 42.7 47.3, 35 53, 32 53 C 29 53, 21.3 47.3, 19.5 38.5 C 17 29, 23 20.5, 32 11.5 Z");

    const pupil = document_.createElementNS(SVG_NS, "circle");
    pupil.setAttribute("class", "cr-flame__pupil");
    pupil.setAttribute("cx", "32");
    pupil.setAttribute("cy", "41");
    pupil.setAttribute("r", "4.1");

    const title = document_.createElementNS(SVG_NS, "title");
    svg.append(defs, title, modeRing, ring, tick, body, pupil);
    return { svg, title };
  }

  /** Derives the single health state shown by the flame from every input we have. */
  function deriveHealth(diagnostics, marketStatus) {
    if (!diagnostics) return marketStatus ? (MARKET_TO_HEALTH[marketStatus] || "OFF") : "OFF";
    if (diagnostics.state === "EMERGENCY_STOP") return "EMERGENCY_STOP";
    if (diagnostics.state === "HALTED" || diagnostics.state === "FAILED" || diagnostics.state === "INVALIDATED") return "HALTED";
    if (diagnostics.state === "PAUSED") return "PAUSED";
    const fromMarket = MARKET_TO_HEALTH[diagnostics.marketDataStatus] || "OFF";
    // A session that is not running yet should not claim HEALTHY just because the feed is.
    if (diagnostics.state === "IDLE" && fromMarket === "HEALTHY" && !diagnostics.warmupComplete) return "WARMING_UP";
    return fromMarket;
  }

  function createControlRoom(options) {
    const root = options.root;
    const doc = options.document || root.ownerDocument;
    const shadowPilot = options.shadowPilot || null;
    const confirm = options.confirm || ((message) => globalScope.confirm(message));

    let diagnostics = null;
    let marketStatus = null;
    let control = null;
    let lastError = null;

    const flame = buildFlame(doc);
    const modeName = element("span", "cr-banner__mode-name", "모드 확인 중");
    const modeNote = element("span", "cr-banner__mode-note", "");
    const flags = element("div", "cr-banner__flags");

    const banner = element("div", "cr-banner");
    const identity = element("div", "cr-banner__identity");
    const modeBox = element("div", "cr-banner__mode");
    modeBox.append(modeName, modeNote);
    identity.append(flame.svg, modeBox);
    banner.append(identity, flags);

    const grid = element("div", "cr-grid");

    const nextGlyph = element("span", "cr-next__glyph", "…");
    nextGlyph.setAttribute("aria-hidden", "true");
    const nextText = element("p", "cr-next__text", "상태를 확인하는 중입니다.");
    const nextBody = element("div", "cr-next__body");
    nextBody.append(element("span", "cr-next__title", "다음 사용자 행동"), nextText);
    const next = element("div", "cr-next");
    next.append(nextGlyph, nextBody);
    // The single most decision-relevant line on the screen; announce changes to it.
    next.setAttribute("role", "status");
    next.setAttribute("aria-live", "polite");

    const shadowTitle = element("h2", "cr-shadow__title", "Shadow 관측 세션");
    const shadowHint = element("p", "cr-shadow__hint", "");
    const shadowHead = element("div", "cr-shadow__head");
    const shadowHeadText = element("div");
    shadowHeadText.append(shadowTitle, shadowHint);
    const actions = element("div", "cr-shadow__actions");
    shadowHead.append(shadowHeadText, actions);

    const startButton = element("button", "cr-button cr-button--primary", "관측 시작");
    const pauseButton = element("button", "cr-button", "일시정지");
    const resumeButton = element("button", "cr-button cr-button--primary", "재개");
    const stopButton = element("button", "cr-button cr-button--danger", "세션 종료");
    for (const button of [startButton, pauseButton, resumeButton, stopButton]) button.type = "button";
    actions.append(startButton, pauseButton, resumeButton, stopButton);

    const counters = element("div", "cr-counters");
    const blockers = element("ul", "cr-blockers");
    const shadow = element("section", "cr-shadow");
    shadow.append(shadowHead, counters, blockers);

    const pipelineTrack = element("div", "cr-pipeline__track");
    const pipelineNote = element("p", "cr-pipeline__note", "");
    const pipeline = element("section", "cr-pipeline");
    pipeline.append(element("h2", "cr-pipeline__title", "신호 처리 단계"), pipelineTrack, pipelineNote);

    // The Why panel is an inline expansion, not a modal: a screen-reader user should be able
    // to read the reason without losing the surrounding context it explains.
    const whyToggle = element("button", "cr-button cr-why__toggle", "왜?");
    whyToggle.type = "button";
    whyToggle.setAttribute("aria-expanded", "false");
    whyToggle.setAttribute("aria-controls", "cr-why-body");
    const whyBody = element("div", "cr-why__body");
    whyBody.id = "cr-why-body";
    whyBody.hidden = true;
    const whyHeadline = element("p", "cr-why__headline", "");
    const whyHead = element("div", "cr-why__head");
    whyHead.append(whyHeadline, whyToggle);
    const why = element("section", "cr-why");
    why.append(whyHead, whyBody);

    root.replaceChildren(banner, grid, next, pipeline, why, shadow);

    let whyOpen = false;
    whyToggle.addEventListener("click", () => {
      whyOpen = !whyOpen;
      whyToggle.setAttribute("aria-expanded", String(whyOpen));
      whyToggle.textContent = whyOpen ? "닫기" : "왜?";
      whyBody.hidden = !whyOpen;
    });

    function setNext(tone, glyph, text) {
      next.className = `cr-next${tone ? ` cr-next--${tone}` : ""}`;
      nextGlyph.textContent = glyph;
      nextText.textContent = text;
    }

    function tile(label, valueNode, note) {
      const node = element("div", "cr-tile");
      node.append(element("span", "cr-tile__label", label), valueNode);
      if (note) node.append(element("span", "cr-tile__note", note));
      return node;
    }

    function counter(label, value) {
      const zero = value === 0;
      const node = element("div", `cr-counter cr-counter--${zero ? "zero" : "nonzero"}`);
      node.append(element("span", "cr-counter__label", label), element("span", "cr-counter__value", String(value)));
      return node;
    }

    function renderFlame(health, mode) {
      const healthClass = health.toLowerCase().replace(/_/g, "-");
      const modeClass = mode ? ` cr-flame--mode-${mode.toLowerCase()}` : "";
      flame.svg.setAttribute("class", `cr-flame cr-flame--${healthClass}${modeClass}`);
      const label = `시스템 상태: ${HEALTH_LABEL[health] || health}${mode ? ` · ${mode} 모드` : ""}`;
      flame.title.textContent = label;
      flame.svg.setAttribute("aria-label", label);
    }

    function renderBanner(health) {
      // Without a Shadow session the app is a plain Paper workspace; say so rather than
      // implying a mode that is not running.
      const mode = diagnostics && diagnostics.state !== "IDLE" ? "SHADOW" : "PAPER";
      renderFlame(health, mode);
      modeName.textContent = mode === "SHADOW" ? "SHADOW 모드" : "PAPER 모드";
      modeNote.textContent = mode === "SHADOW"
        ? "관측 전용 — 가상 체결만 기록됩니다"
        : "로컬 모의 계좌 — 실제 거래소 주문 없음";

      const liveOrders = badge("bad", "✕", "실제 주문 불가");
      const autoResume = badge("bad", "✕", "자동 재개 불가");
      const healthBadge = health === "HEALTHY"
        ? badge("ok", "✔", HEALTH_LABEL.HEALTHY)
        : health === "HALTED" || health === "EMERGENCY_STOP"
          ? badge("bad", "■", HEALTH_LABEL[health])
          : health === "PAUSED"
            ? badge("neutral", "❚❚", HEALTH_LABEL[health])
            : badge("warn", "▲", HEALTH_LABEL[health] || health);
      const modeBadge = mode === "SHADOW" ? badge("shadow", "◈", "SHADOW") : badge("neutral", "◇", "PAPER");
      flags.replaceChildren(healthBadge, modeBadge, liveOrders, autoResume);
    }

    function renderGrid() {
      const marketValue = element("div", "cr-tile__value");
      if (diagnostics) {
        const status = diagnostics.marketDataStatus;
        const tone = status === "HEALTHY" ? "ok" : status === "DISCONNECTED" ? "bad" : "warn";
        const glyph = status === "HEALTHY" ? "✔" : status === "DISCONNECTED" ? "✕" : "▲";
        marketValue.replaceChildren(badge(tone, glyph, MARKET_LABEL[status] || status));
      } else {
        marketValue.replaceChildren(badge("neutral", "—", marketStatus === "connected" ? "연결됨" : "확인 중"));
      }

      const warmupValue = element("div", "cr-tile__value");
      let warmupNote = "closed candle 기준";
      if (diagnostics) {
        const current = diagnostics.closedCandleCount;
        const required = diagnostics.requiredWarmupCandles;
        warmupValue.textContent = `${current} / ${required}`;
        const bar = element("div", `cr-progress${diagnostics.warmupComplete ? "" : " cr-progress--warming"}`);
        const meter = doc.createElement("progress");
        meter.className = "cr-progress__native";
        meter.max = required;
        meter.value = Math.min(current, required);
        meter.setAttribute("aria-label", `예열 진행률 ${current} / ${required}`);
        bar.append(meter);
        warmupValue.append(bar);
        warmupNote = diagnostics.warmupComplete ? "예열 완료" : `${Math.max(0, required - current)}개 더 필요`;
      } else {
        warmupValue.textContent = "—";
      }

      const strategyValue = element("div", "cr-tile__value");
      if (control) {
        const running = control.status === "RUNNING";
        strategyValue.replaceChildren(badge(running ? "ok" : "neutral", running ? "✔" : "❚❚", control.status));
      } else {
        strategyValue.textContent = "—";
      }

      // The risk gateway currently HALTs every path until WO-0032 composition lands. Showing
      // that plainly is the point: a gate that always says no is not the same as no gate.
      const riskValue = element("div", "cr-tile__value");
      riskValue.replaceChildren(badge("bad", "■", "HALT"));

      const reconcileValue = element("div", "cr-tile__value");
      reconcileValue.replaceChildren(badge("warn", "▲", "확인 필요"));

      const sessionValue = element("div", "cr-tile__value", diagnostics && diagnostics.sessionId ? diagnostics.sessionId : "세션 없음");

      grid.replaceChildren(
        tile("시장 데이터", marketValue, diagnostics ? undefined : "Shadow 진단 대기"),
        tile("예열", warmupValue, warmupNote),
        tile("전략", strategyValue, control ? control.strategyId : undefined),
        tile("Risk Gateway", riskValue, "RISK_GATE_NOT_CONFIGURED"),
        tile("정합성", reconcileValue, "reconciliation 미확립"),
        tile("현재 세션", sessionValue, diagnostics ? `상태 ${diagnostics.state}` : undefined)
      );
    }

    function renderShadow() {
      const available = Boolean(shadowPilot);
      const state = diagnostics ? diagnostics.state : null;
      shadowHint.textContent = !available
        ? "이 빌드에서는 Shadow 제어를 사용할 수 없습니다."
        : diagnostics && state === "COMPLETED" && diagnostics.blockers.includes("MAX_SESSION_DURATION_REACHED")
          ? `관측 완료 · 설정된 최대 시간 도달 · 신호 ${diagnostics.signalCount}건 · 실제 주문 ${diagnostics.actualOrderCount}건 · 실제 체결 ${diagnostics.actualFillCount}건`
          : diagnostics
            ? `상태 ${state} · 신호 ${diagnostics.signalCount}건`
            : "진단 정보를 불러오는 중입니다.";

      startButton.disabled = !available || state !== "IDLE";
      pauseButton.disabled = !available || state !== "RUNNING";
      resumeButton.disabled = !available || state !== "PAUSED";
      stopButton.disabled = !available || !["RUNNING", "PAUSED", "HALTED"].includes(state);

      if (diagnostics) {
        counters.replaceChildren(
          counter("실제 주문", diagnostics.actualOrderCount),
          counter("실제 체결", diagnostics.actualFillCount),
          counter("현금 변동", diagnostics.cashMutationCount),
          counter("포지션 변동", diagnostics.positionMutationCount)
        );
      } else {
        counters.replaceChildren();
      }

      const reasons = diagnostics && diagnostics.blockers ? diagnostics.blockers : [];
      if (lastError) {
        blockers.replaceChildren(element("li", "cr-blockers__item", lastError));
      } else if (reasons.length) {
        blockers.replaceChildren(...reasons.map((code) => element("li", "cr-blockers__item", describeBlocker(code))));
      } else {
        blockers.replaceChildren();
      }
    }

    function renderNext(health) {
      if (lastError) {
        setNext("danger", "✕", lastError);
        return;
      }
      if (!shadowPilot) {
        setNext("blocked", "■", "Shadow 제어를 사용할 수 없는 빌드입니다. Paper 수동 주문만 가능합니다.");
        return;
      }
      if (!diagnostics) {
        setNext(null, "…", "Shadow 진단 정보를 불러오는 중입니다.");
        return;
      }
      if (health === "HALTED" || health === "EMERGENCY_STOP") {
        setNext("danger", "■", "세션이 정지되었습니다. 아래 차단 사유를 해결한 뒤 세션을 종료하고 새로 시작하세요.");
        return;
      }
      const reasons = diagnostics.blockers || [];
      if (diagnostics.state === "PAUSED") {
        setNext("blocked", "❚❚", "세션이 일시정지 상태입니다. 재개는 자동으로 일어나지 않으며, 재개 시 사전 점검이 다시 실행됩니다.");
        return;
      }
      if (diagnostics.state === "RUNNING") {
        setNext(null, "✔", "관측이 정상 진행 중입니다. 가상 체결만 기록되며 실제 주문은 발생하지 않습니다.");
        return;
      }
      if (diagnostics.state === "COMPLETED" && reasons.includes("MAX_SESSION_DURATION_REACHED")) {
        setNext("success", "✔", "관측 세션이 설정된 최대 시간에 도달하여 정상적으로 완료되었습니다.");
        return;
      }
      if (reasons.length === 1 && reasons[0] === "MARKET_DATA_WARMING_UP") {
        const remaining = Math.max(0, diagnostics.requiredWarmupCandles - diagnostics.closedCandleCount);
        setNext("blocked", "◔", `예열이 끝나면 관측을 시작할 수 있습니다. closed candle ${remaining}개가 더 필요합니다.`);
        return;
      }
      if (reasons.length) {
        setNext("blocked", "▲", `사전 점검을 통과하지 못했습니다: ${describeBlocker(reasons[0])}`);
        return;
      }
      setNext(null, "▶", "사전 점검을 통과했습니다. 관측을 시작할 수 있습니다.");
    }

    function renderPipeline() {
      const stages = derivePipeline(diagnostics);
      pipelineTrack.replaceChildren(...stages.flatMap((stage, index) => {
        const node = element("div", "cr-stage");
        const presentation = STAGE_TONE[stage.status] || STAGE_TONE.NOT_CALLED;
        node.append(element("span", "cr-stage__name", stage.name), badge(presentation.tone, presentation.glyph, presentation.label));
        return index === 0 ? [node] : [element("span", "cr-stage__link"), node];
      }));
      // Say plainly why two stages read "호출 안 됨" so it is not mistaken for a fault.
      pipelineNote.textContent = diagnostics && diagnostics.lastSignal
        ? "관측 모드에서는 포트폴리오 점검과 브로커 호출 단계를 원래 거치지 않습니다. 실제 주문은 어떤 경우에도 발생하지 않습니다."
        : "아직 처리된 신호가 없습니다. 신호가 발생하면 각 단계의 결과가 여기에 표시됩니다.";
    }

    function whyField(label, value) {
      const node = element("div", "cr-why__field");
      node.append(element("span", "cr-why__key", label), element("span", "cr-why__value", value));
      return node;
    }

    function renderWhy() {
      const signal = diagnostics && diagnostics.lastSignal;
      if (!signal) {
        whyHeadline.textContent = "설명할 신호가 아직 없습니다.";
        whyToggle.disabled = true;
        whyBody.replaceChildren();
        return;
      }
      whyToggle.disabled = false;
      const blocked = signal.riskDecision !== "ALLOW";
      why.className = `cr-why${blocked ? " cr-why--blocked" : ""}`;
      whyHeadline.textContent = blocked
        ? `${signal.signalType === "BUY" ? "매수" : "매도"} 신호가 차단되었습니다`
        : `${signal.signalType === "BUY" ? "매수" : "매도"} 신호가 가상 체결로 기록되었습니다`;

      const fields = element("div", "cr-why__fields");
      // Strategy verdict and risk verdict are always separate rows: one is what the logic
      // wanted, the other is what was permitted, and collapsing them hides the disagreement.
      fields.append(
        whyField("전략 판단", signal.strategyReason),
        whyField("리스크 판단", signal.riskDecision),
        whyField("차단 이유", signal.reasonCodes.length ? signal.reasonCodes.map(describeBlocker).join(" · ") : "없음"),
        whyField("신호 수량", `${signal.quantity} @ ${signal.price}`)
      );

      // The four outcome counters are the operator's own proof that nothing moved.
      const result = element("div", "cr-why__result");
      for (const [label, value] of [["주문", diagnostics.actualOrderCount], ["체결", diagnostics.actualFillCount], ["현금 변화", diagnostics.cashMutationCount], ["포지션 변화", diagnostics.positionMutationCount]]) {
        const item = element("span", "cr-why__result-item");
        item.append(element("span", null, `${label} `), element("b", null, String(value)));
        result.append(item);
      }
      whyBody.replaceChildren(fields, result);
    }

    function render() {
      const health = deriveHealth(diagnostics, marketStatus);
      renderBanner(health);
      renderGrid();
      renderNext(health);
      renderPipeline();
      renderWhy();
      renderShadow();
    }

    async function runCommand(action, confirmation) {
      if (!shadowPilot) return;
      if (confirmation && !confirm(confirmation)) return;
      try {
        lastError = null;
        diagnostics = await action();
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      render();
    }

    startButton.addEventListener("click", () => runCommand(() => shadowPilot.start()));
    pauseButton.addEventListener("click", () => runCommand(() => shadowPilot.pause(diagnostics.sessionId)));
    // Resuming re-runs the full precheck, so it is a deliberate state change, not a toggle.
    resumeButton.addEventListener("click", () => runCommand(
      () => shadowPilot.resume(diagnostics.sessionId),
      "관측을 재개하면 사전 점검이 다시 실행됩니다. 계속할까요?"
    ));
    stopButton.addEventListener("click", () => runCommand(
      () => shadowPilot.stop(diagnostics.sessionId),
      "세션을 종료하면 같은 세션으로 다시 시작할 수 없습니다. 계속할까요?"
    ));

    async function refresh() {
      if (!shadowPilot) {
        render();
        return;
      }
      try {
        diagnostics = await shadowPilot.status();
        lastError = null;
      } catch {
        diagnostics = null;
      }
      render();
    }

    render();

    return {
      refresh,
      setMarketStatus(status) { marketStatus = status; render(); },
      setControlSnapshot(snapshot) { control = snapshot; render(); },
      element: root
    };
  }

  globalScope.DokkaebiControlRoom = { createControlRoom, deriveHealth, derivePipeline, describeBlocker, HEALTH, HEALTH_LABEL, STAGES };
})(window);
