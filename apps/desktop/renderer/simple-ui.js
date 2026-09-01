(function mountCanonicalNUSA(global) {
  "use strict";

  const document = global.document;
  const root = document?.getElementById("simple-ui-root");
  if (!document || !root) return;

  const viewModel = global.NUSAMobileViewModel;
  const unsubscribers = [];
  const money = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
  const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 8 });
  const pages = Object.freeze({ dashboard: "홈", portfolio: "포트폴리오", nusa: "NUSA", logs: "기록", settings: "설정" });
  const state = { page: "dashboard", connectionCode: "unknown", connection: "unknown", lastPrice: null, changeRate: null, snapshot: null, control: null, chartPoints: [], updatedAt: null };

  function finite(value) { return typeof value === "number" && Number.isFinite(value); }
  function moneyValue(value) { return viewModel?.formatMoney(value) || (finite(value) ? money.format(value) : "-"); }
  function quantityValue(value) { return viewModel?.formatQuantity(value) || (finite(value) ? number.format(value) : "-"); }
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

  function shell() {
    root.innerHTML = `
      <div class="nusa-app">
        <aside class="nusa-sidebar" aria-label="주요 메뉴">
          <div class="nusa-brand"><img src="assets/nusa-a4p-symbol.svg" alt="" /><div><strong>NUSA</strong><span>Investment Operator</span></div></div>
          <nav class="nusa-nav">
            <button type="button" data-nav="dashboard">홈</button>
            <button type="button" data-nav="portfolio">포트폴리오</button>
            <button type="button" data-nav="nusa">NUSA</button>
            <button type="button" data-nav="logs">기록</button>
            <button type="button" data-nav="settings">설정</button>
          </nav>
          <div class="nusa-sidebar-status"><div class="nusa-status-line" data-connection><span class="nusa-status-dot"></span><strong>확인 중</strong></div><small>REAL은 사용자 승인 없이는 실행되지 않습니다.</small></div>
        </aside>
        <div class="nusa-main">
          <header class="nusa-header"><h1 data-page-title>홈</h1><div class="nusa-header-meta"><span data-updated>업데이트 대기</span><span class="nusa-badge">PAPER 자동 학습</span><span class="nusa-badge nusa-badge--real">REAL 승인 필요</span></div></header>
          <main class="nusa-content" tabindex="-1">
            <section class="nusa-page" data-page="dashboard"></section>
            <section class="nusa-page" data-page="portfolio" hidden></section>
            <section class="nusa-page" data-page="nusa" hidden></section>
            <section class="nusa-page" data-page="logs" hidden></section>
            <section class="nusa-page" data-page="settings" hidden></section>
          </main>
        </div>
      </div>`;
  }

  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];

  function pageHead(eyebrow, title, copy) {
    return `<div class="nusa-page-head"><div><div class="nusa-eyebrow">${eyebrow}</div><h2>${title}</h2><p>${copy}</p></div></div>`;
  }
  function positionDetails() {
    const s = summary();
    const position = s.position || state.snapshot?.position || {};
    const hasPosition = Boolean(s.hasPosition || (finite(position.quantity) && position.quantity > 0));
    if (!hasPosition) return `<div class="nusa-empty">현재 표시할 포지션이 없습니다.</div>`;
    const current = finite(state.lastPrice) ? state.lastPrice : null;
    const pnl = finite(state.snapshot?.unrealizedPnl) ? state.snapshot.unrealizedPnl : null;
    const rate = current != null && finite(position.averagePrice) && position.averagePrice > 0 ? (current - position.averagePrice) / position.averagePrice : null;
    return `<dl class="nusa-kv"><div><dt>마켓</dt><dd>${position.market || "KRW-BTC"}</dd></div><div><dt>보유 수량</dt><dd>${quantityValue(position.quantity)}</dd></div><div><dt>평균 단가</dt><dd>${moneyValue(position.averagePrice)}</dd></div><div><dt>현재가</dt><dd>${moneyValue(current)}</dd></div><div><dt>평가 손익</dt><dd class="${pnl != null && pnl < 0 ? "nusa-negative" : "nusa-positive"}">${signedMoney(pnl)} · ${signedPercent(rate)}</dd></div></dl>`;
  }
  function paperMetrics() {
    const s = summary();
    const orders = Array.isArray(state.snapshot?.orders) ? state.snapshot.orders.length : s.orderCount;
    return `<dl class="nusa-kv"><div><dt>Paper 평가 자산</dt><dd>${moneyValue(state.snapshot?.equity)}</dd></div><div><dt>평가 손익</dt><dd>${signedMoney(state.snapshot?.unrealizedPnl)}</dd></div><div><dt>실현 손익</dt><dd>${signedMoney(state.snapshot?.position?.realizedPnl)}</dd></div><div><dt>관측 거래</dt><dd>${Number.isFinite(orders) ? `${orders}건` : "-"}</dd></div></dl>`;
  }
  function chartMarkup() { return `<div class="nusa-chart" data-chart><div class="nusa-empty">학습 성과 추이를 수집하고 있습니다.</div></div>`; }

  function renderHome() {
    const [decision, reason] = judgement();
    const page = $('[data-page="dashboard"]');
    page.innerHTML = `${pageHead("OVERVIEW", "오늘의 상태", "자산, NUSA 판단, REAL 안전 상태와 PAPER 학습 결과를 한눈에 봅니다.")}
      <div class="nusa-grid">
        <article class="nusa-card nusa-card--metric"><span class="nusa-card-label">REAL 총 자산</span><strong class="nusa-metric">연결 전</strong><span class="nusa-submetric">실계좌 연결 전에는 값을 표시하지 않습니다.</span></article>
        <article class="nusa-card nusa-card--metric"><span class="nusa-card-label">REAL 오늘 손익</span><strong class="nusa-metric">-</strong><span class="nusa-submetric">실제 체결 데이터 기준으로만 표시</span></article>
        <article class="nusa-card nusa-card--metric"><span class="nusa-card-label">시장 데이터</span><strong class="nusa-metric">${state.connection === "connected" ? "정상" : "확인 중"}</strong><span class="nusa-submetric">BTC/KRW ${moneyValue(state.lastPrice)}</span></article>
        <article class="nusa-card nusa-card--wide"><div class="nusa-section-head"><div><h3>시장 / 성과 추이</h3><p>현재 연결된 데이터 범위</p></div><span>${signedPercent(state.changeRate)}</span></div>${chartMarkup()}</article>
        <article class="nusa-card nusa-card--side"><div class="nusa-section-head"><div><h3>NUSA 현재 판단</h3><p>실행 권한과 분리된 판단 정보</p></div></div><div class="nusa-judgement"><strong>${decision}</strong><p>${reason}</p><div class="nusa-notice"><strong>REAL 주문:</strong> 사용자 비밀번호 + 지문 승인 전 실행 불가</div></div></article>
        <article class="nusa-card nusa-card--wide"><div class="nusa-section-head"><div><h3>현재 REAL 포지션</h3><p>실계좌 연결 전에는 PAPER 포지션을 REAL처럼 표시하지 않습니다.</p></div></div><div class="nusa-empty">REAL 계좌 데이터 연결 전</div></article>
        <article class="nusa-card nusa-card--side"><div class="nusa-section-head"><div><h3>PAPER 학습 결과</h3><p>수동 주문 기능 없음</p></div></div>${paperMetrics()}</article>
      </div>`;
  }

  function renderPortfolio() {
    const page = $('[data-page="portfolio"]');
    page.innerHTML = `${pageHead("PORTFOLIO", "포트폴리오", "REAL 자산과 PAPER 학습 성과를 혼동하지 않고 분리해서 표시합니다.")}
      <div class="nusa-grid"><article class="nusa-card nusa-card--wide"><div class="nusa-section-head"><div><h3>REAL 자산</h3><p>실계좌 데이터가 연결된 경우에만 표시</p></div></div><div class="nusa-empty">REAL 계좌 연결 전</div></article><article class="nusa-card nusa-card--side"><div class="nusa-section-head"><div><h3>PAPER 학습 결과</h3><p>자동 학습 성과 요약</p></div></div>${paperMetrics()}</article><article class="nusa-card nusa-card--full"><div class="nusa-section-head"><div><h3>리스크</h3><p>실제 위험 지표는 REAL 데이터가 있을 때만 계산합니다.</p></div></div><div class="nusa-notice">현재 REAL 계좌가 연결되어 있지 않아 실제 노출, MDD, 손실 한도를 임의로 계산하지 않습니다.</div></article></div>`;
  }

  function renderNUSA() {
    const [decision, reason] = judgement();
    const status = String(state.control?.status || "STOPPED");
    const page = $('[data-page="nusa"]');
    page.innerHTML = `${pageHead("DECISION", "NUSA", "현재 판단, 근거, 전략 상태와 학습 결과를 보여줍니다.")}
      <div class="nusa-grid"><article class="nusa-card nusa-card--wide"><div class="nusa-section-head"><div><h3>현재 판단</h3><p>판단은 승인이나 체결을 의미하지 않습니다.</p></div></div><div class="nusa-judgement"><strong>${decision}</strong><p>${reason}</p></div></article><article class="nusa-card nusa-card--side"><div class="nusa-section-head"><div><h3>운용 상태</h3><p>현재 control snapshot</p></div></div><dl class="nusa-kv"><div><dt>전략</dt><dd>${status === "RUNNING" ? "실행 중" : status === "PAUSED" ? "일시 중지" : "중지됨"}</dd></div><div><dt>PAPER 자동운용</dt><dd>${state.control?.autoTradeEnabled ? "활성" : "비활성"}</dd></div><div><dt>시장 데이터</dt><dd>${state.connection === "connected" ? "정상" : "확인 필요"}</dd></div></dl></article><article class="nusa-card nusa-card--full"><div class="nusa-section-head"><div><h3>학습 결과</h3><p>PAPER의 개별 주문 조작 대신 결과만 표시합니다.</p></div></div>${paperMetrics()}</article></div>`;
  }

  function eventRows() {
    const events = Array.isArray(state.control?.events) ? state.control.events.slice(0, 30) : [];
    if (!events.length) return `<div class="nusa-empty">기록된 운영 이벤트가 없습니다.</div>`;
    return `<div class="nusa-timeline">${events.map((event) => `<div class="nusa-event"><div><strong>${event.type || "운영 이벤트"}</strong><small>${event.message || ""}</small></div><time>${event.timestamp ? new Date(event.timestamp).toLocaleTimeString("ko-KR") : "-"}</time></div>`).join("")}</div>`;
  }
  function renderLogs() {
    const page = $('[data-page="logs"]');
    page.innerHTML = `${pageHead("HISTORY", "기록", "판단, 리스크, 운용 이벤트를 시간순으로 확인합니다.")}<div class="nusa-grid"><article class="nusa-card nusa-card--full">${eventRows()}</article></div>`;
  }
  function renderSettings() {
    const page = $('[data-page="settings"]');
    page.innerHTML = `${pageHead("SETTINGS", "설정", "REAL 안전 규칙과 알림 정책을 확인합니다.")}<div class="nusa-grid"><article class="nusa-card nusa-card--wide"><div class="nusa-section-head"><div><h3>REAL 승인</h3><p>안전 계약</p></div></div><dl class="nusa-kv"><div><dt>승인 방식</dt><dd>비밀번호 + 지문</dd></div><div><dt>단일 인증 우회</dt><dd>허용 안 함</dd></div><div><dt>승인 범위</dt><dd>주문 1건</dd></div><div><dt>주문 변경 시</dt><dd>승인 무효</dd></div></dl></article><article class="nusa-card nusa-card--side"><div class="nusa-section-head"><div><h3>PAPER</h3><p>학습 전용</p></div></div><div class="nusa-notice"><strong>자동 학습</strong><br/>수동 Paper 매수/매도 버튼은 제공하지 않습니다. 사용자는 학습 결과만 확인합니다.</div></article></div>`;
  }

  function renderChart() {
    const target = $("[data-chart]");
    if (!target) return;
    const values = state.chartPoints.map((point) => point.value).filter(finite);
    if (values.length < 2) return;
    const min = Math.min(...values), max = Math.max(...values), range = Math.max(1, max - min);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 800 220"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "PAPER 학습 성과 추이");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("fill", "none"); line.setAttribute("stroke", "currentColor"); line.setAttribute("stroke-width", "3");
    line.setAttribute("points", values.map((value, index) => `${16 + index / (values.length - 1) * 768},${204 - (value - min) / range * 188}`).join(" "));
    svg.append(line); target.replaceChildren(svg);
  }
  function renderConnection() {
    const [tone, label] = normalizeConnection(state.connectionCode); state.connection = tone;
    const target = $("[data-connection]"); if (target) { target.dataset.state = tone; target.querySelector("strong").textContent = label; target.querySelector(".nusa-status-dot").dataset.state = tone; }
  }
  function renderAll() {
    renderConnection(); renderHome(); renderPortfolio(); renderNUSA(); renderLogs(); renderSettings(); renderChart();
    $('[data-updated]').textContent = state.updatedAt ? `업데이트 ${state.updatedAt.toLocaleTimeString("ko-KR")}` : "업데이트 대기";
    showPage(state.page, false);
  }
  function showPage(target, updateHash = true) {
    const page = Object.prototype.hasOwnProperty.call(pages, target) ? target : "dashboard"; state.page = page;
    $$('[data-page]').forEach((section) => { const active = section.dataset.page === page; section.hidden = !active; });
    $$('[data-nav]').forEach((button) => { const active = button.dataset.nav === page; button.classList.toggle("is-active", active); if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); });
    $('[data-page-title]').textContent = pages[page];
    if (updateHash && global.location.hash !== `#${page}`) global.history.replaceState(null, "", `#${page}`);
  }
  function installEvents() {
    $$('[data-nav]').forEach((button) => button.addEventListener("click", () => showPage(button.dataset.nav)));
    global.addEventListener("hashchange", () => showPage(global.location.hash.slice(1), false));
    const api = global.nusa; if (!api) return;
    if (typeof api.onStatus === "function") unsubscribers.push(api.onStatus((value) => { state.connectionCode = value; state.updatedAt = new Date(); renderAll(); }));
    if (typeof api.onTicker === "function") unsubscribers.push(api.onTicker((value) => { if (finite(value?.trade_price)) state.lastPrice = value.trade_price; if (finite(value?.signed_change_rate)) state.changeRate = value.signed_change_rate; state.updatedAt = new Date(); renderAll(); }));
    if (typeof api.onSnapshot === "function") unsubscribers.push(api.onSnapshot((value) => { state.snapshot = value || null; state.updatedAt = new Date(); renderAll(); }));
    if (typeof api.onControl === "function") unsubscribers.push(api.onControl((value) => { state.control = value || null; state.updatedAt = new Date(); renderAll(); }));
    if (typeof api.onChartPoint === "function") unsubscribers.push(api.onChartPoint((value) => { if (finite(value?.value)) { state.chartPoints.push(value); state.chartPoints = state.chartPoints.slice(-120); } renderAll(); }));
  }
  async function read(method) { try { return typeof method === "function" ? await method() : null; } catch { return null; } }
  async function loadInitial() {
    const api = global.nusa;
    const [snapshot, control] = await Promise.all([read(api?.getSnapshot?.bind(api)), read(api?.getControlSnapshot?.bind(api))]);
    if (snapshot) state.snapshot = snapshot; if (control) state.control = control; state.updatedAt = new Date(); renderAll();
  }

  shell(); installEvents(); showPage(global.location.hash.slice(1) || "dashboard", false); renderAll(); void loadInitial();
  global.addEventListener("beforeunload", () => unsubscribers.forEach((unsubscribe) => { try { unsubscribe?.(); } catch {} }));
  global.NUSASimpleUI = Object.freeze({ showPage, state });
})(window);
