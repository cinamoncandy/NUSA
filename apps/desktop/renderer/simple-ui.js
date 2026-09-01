(function mountCanonicalNUSA(global) {
  "use strict";

  const document = global.document;
  const root = document?.getElementById("simple-ui-root");
  if (!document || !root) return;

  const viewModel = global.NUSAMobileViewModel;
  const unsubscribers = [];
  const money = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
  const pages = Object.freeze({ dashboard: "홈", portfolio: "포트폴리오", nusa: "NUSA", logs: "기록", settings: "설정" });
  const state = {
    page: "dashboard",
    connectionCode: "unknown",
    connection: "unknown",
    connectionLabel: "확인 중",
    lastPrice: null,
    changeRate: null,
    snapshot: null,
    control: null,
    chartPoints: [],
    updatedAt: null
  };

  function finite(value) { return typeof value === "number" && Number.isFinite(value); }
  function moneyValue(value) { return viewModel?.formatMoney(value) || (finite(value) ? money.format(value) : "-"); }
  function signedMoney(value) { return viewModel?.formatSignedMoney(value) || (finite(value) ? `${value >= 0 ? "+" : ""}${moneyValue(value)}` : "-"); }
  function signedPercent(value) { return viewModel?.formatSignedPercent(value) || (finite(value) ? `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%` : "-"); }
  function normalizeConnection(value) {
    if (viewModel?.normalizeConnection) return viewModel.normalizeConnection(value);
    const code = String(value ?? "").toLowerCase();
    if (code === "connected" || ["online", "healthy", "fresh"].some((item) => code.includes(item))) return ["connected", "정상"];
    if (["disconnect", "stale", "offline"].some((item) => code.includes(item))) return ["disconnected", "연결 이상"];
    if (["error", "fault"].some((item) => code.includes(item))) return ["error", "오류"];
    if (code.includes("connect")) return ["connecting", "연결 중"];
    return ["unknown", "확인 중"];
  }
  function summary() { return viewModel?.summarize(state.snapshot, state.lastPrice) || {}; }
  function latestControlEvent() { return Array.isArray(state.control?.events) && state.control.events.length ? state.control.events[0] : null; }
  function judgement() {
    const latest = latestControlEvent();
    const raw = String(latest?.type || latest?.signal || "").toUpperCase();
    if (raw.includes("BUY")) return ["매수 검토", latest?.message || "전략 신호가 매수 방향을 가리키고 있습니다."];
    if (raw.includes("SELL")) return ["매도 검토", latest?.message || "전략 신호가 매도 방향을 가리키고 있습니다."];
    if (raw.includes("RISK") || raw.includes("BLOCK")) return ["위험 회피", latest?.message || "리스크 조건으로 신규 거래가 제한되었습니다."];
    return ["관망", latest?.message || "현재 확인 가능한 실행 신호가 없습니다."];
  }

  function make(tag, options = {}, children = []) {
    const element = document.createElement(tag);
    if (options.className) element.className = options.className;
    if (options.text != null) element.textContent = String(options.text);
    for (const [name, value] of Object.entries(options.attrs || {})) {
      if (value != null) element.setAttribute(name, String(value));
    }
    for (const [name, value] of Object.entries(options.dataset || {})) {
      element.dataset[name] = String(value);
    }
    element.append(...children.filter(Boolean));
    return element;
  }
  function textNode(value) { return document.createTextNode(String(value)); }
  function empty(copy) { return make("div", { className: "nusa-empty", text: copy }); }
  function pageHead(eyebrow, title, copy) {
    return make("div", { className: "nusa-page-head" }, [
      make("div", {}, [
        make("div", { className: "nusa-eyebrow", text: eyebrow }),
        make("h2", { text: title }),
        make("p", { text: copy })
      ])
    ]);
  }
  function sectionHead(title, copy, trailing = null) {
    return make("div", { className: "nusa-section-head" }, [
      make("div", {}, [make("h3", { text: title }), make("p", { text: copy })]),
      trailing
    ]);
  }
  function card(modifier, children) { return make("article", { className: `nusa-card ${modifier}`.trim() }, children); }
  function metricCard(label, value, copy) {
    return card("nusa-card--metric", [
      make("span", { className: "nusa-card-label", text: label }),
      make("strong", { className: "nusa-metric", text: value }),
      make("span", { className: "nusa-submetric", text: copy })
    ]);
  }
  function kv(rows) {
    return make("dl", { className: "nusa-kv" }, rows.map(([label, value, className]) =>
      make("div", {}, [make("dt", { text: label }), make("dd", { className: className || "", text: value })])
    ));
  }
  function notice(prefix, copy) {
    return make("div", { className: "nusa-notice" }, [make("strong", { text: prefix }), textNode(` ${copy}`)]);
  }
  function paperMetrics() {
    const s = summary();
    const orders = Array.isArray(state.snapshot?.orders) ? state.snapshot.orders.length : s.orderCount;
    return kv([
      ["Paper 평가 자산", moneyValue(state.snapshot?.equity)],
      ["평가 손익", signedMoney(state.snapshot?.unrealizedPnl)],
      ["실현 손익", signedMoney(state.snapshot?.position?.realizedPnl)],
      ["관측 거래", Number.isFinite(orders) ? `${orders}건` : "-"]
    ]);
  }
  function chartSurface() {
    return make("div", { className: "nusa-chart", dataset: { chart: "" } }, [empty("학습 성과 추이를 수집하고 있습니다.")]);
  }
  function navButtons(className, ariaLabel) {
    return make("nav", { className, attrs: { "aria-label": ariaLabel } }, Object.entries(pages).map(([key, label]) =>
      make("button", { text: label, attrs: { type: "button" }, dataset: { nav: key } })
    ));
  }

  function shell() {
    const brand = make("div", { className: "nusa-brand" }, [
      make("img", { attrs: { src: "assets/nusa-a4p-symbol.svg", alt: "" } }),
      make("div", {}, [make("strong", { text: "NUSA" }), make("span", { text: "Investment Operator" })])
    ]);
    const status = make("div", { className: "nusa-sidebar-status" }, [
      make("div", { className: "nusa-status-line", dataset: { connection: "" } }, [
        make("span", { className: "nusa-status-dot", attrs: { "aria-hidden": "true" } }),
        make("strong", { text: "확인 중" })
      ]),
      make("small", { text: "REAL은 사용자 승인 없이는 실행되지 않습니다." })
    ]);
    const sidebar = make("aside", { className: "nusa-sidebar", attrs: { "aria-label": "주요 메뉴" } }, [brand, navButtons("nusa-nav", "데스크톱 메뉴"), status]);
    const header = make("header", { className: "nusa-header" }, [
      make("h1", { text: "홈", dataset: { pageTitle: "" } }),
      make("div", { className: "nusa-header-meta" }, [
        make("span", { text: "업데이트 대기", dataset: { updated: "" } }),
        make("span", { className: "nusa-badge", text: "PAPER 자동 학습" }),
        make("span", { className: "nusa-badge nusa-badge--real", text: "REAL 승인 필요" })
      ])
    ]);
    const content = make("main", { className: "nusa-content", attrs: { tabindex: "-1" } }, Object.keys(pages).map((key, index) => {
      const section = make("section", { className: "nusa-page", dataset: { page: key } });
      section.hidden = index !== 0;
      return section;
    }));
    const main = make("div", { className: "nusa-main" }, [header, content]);
    const app = make("div", { className: "nusa-app" }, [sidebar, main, navButtons("nusa-bottom-nav", "모바일 메뉴")]);
    root.replaceChildren(app);
  }

  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];

  function renderHome() {
    const [decision, reason] = judgement();
    const page = $('[data-page="dashboard"]');
    const grid = make("div", { className: "nusa-grid" }, [
      metricCard("REAL 총 자산", "연결 전", "실계좌 연결 전에는 값을 표시하지 않습니다."),
      metricCard("REAL 오늘 손익", "-", "실제 체결 데이터 기준으로만 표시"),
      metricCard("시장 데이터", state.connection === "connected" ? "정상" : state.connectionLabel, `BTC/KRW ${moneyValue(state.lastPrice)}`),
      card("nusa-card--wide", [sectionHead("시장 / 성과 추이", "현재 연결된 데이터 범위", make("span", { text: signedPercent(state.changeRate) })), chartSurface()]),
      card("nusa-card--side", [
        sectionHead("NUSA 현재 판단", "실행 권한과 분리된 판단 정보"),
        make("div", { className: "nusa-judgement" }, [
          make("strong", { text: decision }),
          make("p", { text: reason }),
          notice("REAL 주문:", "사용자 비밀번호 + 지문 승인 전 실행 불가")
        ])
      ]),
      card("nusa-card--wide", [sectionHead("현재 REAL 포지션", "실계좌 연결 전에는 PAPER 포지션을 REAL처럼 표시하지 않습니다."), empty("REAL 계좌 데이터 연결 전")]),
      card("nusa-card--side", [sectionHead("PAPER 학습 결과", "수동 주문 기능 없음"), paperMetrics()])
    ]);
    page.replaceChildren(pageHead("OVERVIEW", "오늘의 상태", "자산, NUSA 판단, REAL 안전 상태와 PAPER 학습 결과를 한눈에 봅니다."), grid);
  }

  function renderPortfolio() {
    const page = $('[data-page="portfolio"]');
    const grid = make("div", { className: "nusa-grid" }, [
      card("nusa-card--wide", [sectionHead("REAL 자산", "실계좌 데이터가 연결된 경우에만 표시"), empty("REAL 계좌 연결 전")]),
      card("nusa-card--side", [sectionHead("PAPER 학습 결과", "자동 학습 성과 요약"), paperMetrics()]),
      card("nusa-card--full", [sectionHead("리스크", "실제 위험 지표는 REAL 데이터가 있을 때만 계산합니다."), notice("REAL 데이터 없음:", "실제 노출, MDD, 손실 한도를 임의로 계산하지 않습니다.")])
    ]);
    page.replaceChildren(pageHead("PORTFOLIO", "포트폴리오", "REAL 자산과 PAPER 학습 성과를 혼동하지 않고 분리해서 표시합니다."), grid);
  }

  function renderNUSA() {
    const [decision, reason] = judgement();
    const status = String(state.control?.status || "STOPPED");
    const strategyStatus = status === "RUNNING" ? "실행 중" : status === "PAUSED" ? "일시 중지" : "중지됨";
    const page = $('[data-page="nusa"]');
    const grid = make("div", { className: "nusa-grid" }, [
      card("nusa-card--wide", [
        sectionHead("현재 판단", "판단은 승인이나 체결을 의미하지 않습니다."),
        make("div", { className: "nusa-judgement" }, [make("strong", { text: decision }), make("p", { text: reason })])
      ]),
      card("nusa-card--side", [sectionHead("운용 상태", "현재 control snapshot"), kv([
        ["전략", strategyStatus],
        ["PAPER 자동운용", state.control?.autoTradeEnabled ? "활성" : "비활성"],
        ["시장 데이터", state.connection === "connected" ? "정상" : "확인 필요"]
      ])]),
      card("nusa-card--full", [sectionHead("학습 결과", "PAPER의 개별 주문 조작 대신 결과만 표시합니다."), paperMetrics()])
    ]);
    page.replaceChildren(pageHead("DECISION", "NUSA", "현재 판단, 근거, 전략 상태와 학습 결과를 보여줍니다."), grid);
  }

  function eventTimeline() {
    const events = Array.isArray(state.control?.events) ? state.control.events.slice(0, 30) : [];
    if (!events.length) return empty("기록된 운영 이벤트가 없습니다.");
    return make("div", { className: "nusa-timeline" }, events.map((event) =>
      make("div", { className: "nusa-event" }, [
        make("div", {}, [
          make("strong", { text: event.type || "운영 이벤트" }),
          make("small", { text: event.message || "" })
        ]),
        make("time", { text: event.timestamp ? new Date(event.timestamp).toLocaleTimeString("ko-KR") : "-" })
      ])
    ));
  }

  function renderLogs() {
    const page = $('[data-page="logs"]');
    const grid = make("div", { className: "nusa-grid" }, [card("nusa-card--full", [eventTimeline()])]);
    page.replaceChildren(pageHead("HISTORY", "기록", "판단, 리스크, 운용 이벤트를 시간순으로 확인합니다."), grid);
  }

  function renderSettings() {
    const page = $('[data-page="settings"]');
    const grid = make("div", { className: "nusa-grid" }, [
      card("nusa-card--wide", [sectionHead("REAL 승인", "안전 계약"), kv([
        ["승인 방식", "비밀번호 + 지문"],
        ["단일 인증 우회", "허용 안 함"],
        ["승인 범위", "주문 1건"],
        ["주문 변경 시", "기존 승인 즉시 무효"]
      ])]),
      card("nusa-card--side", [sectionHead("PAPER", "자동 학습"), notice("사용자 조작 없음:", "PAPER는 주문 버튼 없이 학습 결과만 제공합니다.")]),
      card("nusa-card--full", [sectionHead("상태 구분", "승인과 체결을 혼동하지 않습니다."), notice("안전 원칙:", "판단됨 ≠ 승인됨 ≠ 주문됨 ≠ 체결됨")])
    ]);
    page.replaceChildren(pageHead("SETTINGS", "설정", "REAL 안전 규칙과 PAPER 표시 정책을 확인합니다."), grid);
  }

  function renderChart() {
    const target = $("[data-chart]");
    if (!target) return;
    const values = state.chartPoints.map((point) => point?.value).filter(finite);
    if (values.length < 2) {
      target.replaceChildren(empty("학습 성과 추이를 수집하고 있습니다."));
      return;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 800 220");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "PAPER 학습 성과 추이");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "3");
    line.setAttribute("points", values.map((value, index) => `${16 + index / (values.length - 1) * 768},${204 - (value - min) / range * 188}`).join(" "));
    svg.append(line);
    target.replaceChildren(svg);
  }

  function renderConnection() {
    const [tone, label] = normalizeConnection(state.connectionCode);
    state.connection = tone;
    state.connectionLabel = label;
    $$('[data-connection]').forEach((element) => {
      element.dataset.state = tone;
      const strong = element.querySelector("strong");
      if (strong) strong.textContent = label;
    });
  }

  function renderNav() {
    $$('[data-nav]').forEach((button) => {
      const active = button.dataset.nav === state.page;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
    });
    const title = $('[data-page-title]');
    if (title) title.textContent = pages[state.page] || pages.dashboard;
  }

  function renderAll() {
    renderConnection();
    renderHome();
    renderPortfolio();
    renderNUSA();
    renderLogs();
    renderSettings();
    renderNav();
    renderChart();
    const updated = $('[data-updated]');
    if (updated) updated.textContent = state.updatedAt ? `업데이트 ${state.updatedAt.toLocaleTimeString("ko-KR")}` : "업데이트 대기";
  }

  function showPage(target, updateHash = true) {
    const page = Object.prototype.hasOwnProperty.call(pages, target) ? target : "dashboard";
    state.page = page;
    $$('[data-page]').forEach((section) => { section.hidden = section.dataset.page !== page; });
    renderNav();
    if (updateHash && global.location.hash !== `#${page}`) global.history.replaceState(null, "", `#${page}`);
    if (page !== "dashboard") $(".nusa-content")?.focus({ preventScroll: true });
  }

  function installEvents() {
    $$('[data-nav]').forEach((button) => button.addEventListener("click", () => showPage(button.dataset.nav)));
    global.addEventListener("hashchange", () => showPage(global.location.hash.slice(1), false));
    const api = global.nusa;
    if (!api) return;
    if (typeof api.onStatus === "function") unsubscribers.push(api.onStatus((value) => { state.connectionCode = value; state.updatedAt = new Date(); renderAll(); }));
    if (typeof api.onTicker === "function") unsubscribers.push(api.onTicker((value) => {
      if (finite(value?.trade_price)) state.lastPrice = value.trade_price;
      state.changeRate = finite(value?.signed_change_rate) ? value.signed_change_rate : null;
      state.updatedAt = new Date();
      renderAll();
    }));
    if (typeof api.onSnapshot === "function") unsubscribers.push(api.onSnapshot((value) => { state.snapshot = value || null; state.updatedAt = new Date(); renderAll(); }));
    if (typeof api.onControl === "function") unsubscribers.push(api.onControl((value) => { state.control = value || null; state.updatedAt = new Date(); renderAll(); }));
    if (typeof api.onChartPoint === "function") unsubscribers.push(api.onChartPoint((value) => {
      if (finite(value?.value)) {
        state.chartPoints.push(value);
        state.chartPoints = state.chartPoints.slice(-120);
        renderChart();
      }
    }));
  }

  async function read(method, fallback = null) {
    try { return typeof method === "function" ? await method() : fallback; } catch { return fallback; }
  }
  async function loadInitial() {
    const api = global.nusa;
    const [snapshot, control] = await Promise.all([
      read(api?.getSnapshot?.bind(api)),
      read(api?.getControlSnapshot?.bind(api))
    ]);
    if (snapshot) state.snapshot = snapshot;
    if (control) state.control = control;
    state.updatedAt = new Date();
    renderAll();
  }

  shell();
  installEvents();
  showPage(global.location.hash.slice(1) || "dashboard", false);
  renderAll();
  void loadInitial();
  global.addEventListener("beforeunload", () => unsubscribers.forEach((unsubscribe) => { try { unsubscribe?.(); } catch { /* best effort */ } }));
  global.NUSASimpleUI = Object.freeze({ showPage, state });
})(window);
