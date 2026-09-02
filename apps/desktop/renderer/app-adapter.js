(function mountNusaV2Adapter(global) {
  "use strict";

  const document = global.document;
  const root = document?.getElementById("simple-ui-root");
  if (!document || !root) return;

  const pageToNav = Object.freeze({
    dashboard: "dashboard",
    orders: "orders",
    market: "orders",
    positions: "positions",
    balance: "positions",
    strategy: "strategy",
    logs: "logs",
    settings: "settings",
    more: "settings"
  });

  function normalizeLegacyRoute() {
    const page = global.location.hash.slice(1);
    const replacement = page === "market" ? "orders" : page === "balance" ? "positions" : page === "more" ? "settings" : null;
    if (!replacement) return false;
    root.querySelector(`[data-simple-nav="${replacement}"]`)?.click();
    return true;
  }

  function syncNavigation() {
    const page = global.location.hash.slice(1) || "dashboard";
    const active = pageToNav[page] || "dashboard";
    root.querySelectorAll(".v2-nav__item[data-simple-nav]").forEach((button) => {
      const selected = button.dataset.simpleNav === active;
      button.classList.toggle("is-active", selected);
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  }

  function alignRuntimeLanguage() {
    const tradingStatus = root.querySelector('[data-simple-page="orders"] .v2-decision-card > span');
    if (tradingStatus) tradingStatus.textContent = "NUSA 상태";
    const tradingDataLabel = root.querySelector('[data-simple-page="orders"] .v2-decision-card dt');
    if (tradingDataLabel) tradingDataLabel.textContent = "시장 데이터";
    const nusaTitle = root.querySelector('[data-simple-page="strategy"] .v2-page-title h1');
    if (nusaTitle) nusaTitle.textContent = "상태와 이벤트";
    const nusaPanelTitle = root.querySelector('[data-simple-page="strategy"] .v2-home-grid .v2-panel h2');
    if (nusaPanelTitle) nusaPanelTitle.textContent = "운영 상태";
    root.querySelectorAll('[data-simple-nav="strategy"].v2-link').forEach((button) => { button.textContent = "NUSA 상태 보기"; });
    const orderSheet = root.querySelector("[data-simple-sheet]");
    if (orderSheet) {
      orderSheet.setAttribute("role", "dialog");
      orderSheet.setAttribute("aria-modal", "true");
      orderSheet.setAttribute("aria-labelledby", "v2-order-sheet-title");
    }
  }

  function mirrorTimeline() {
    const lists = [...root.querySelectorAll("[data-simple-log-list]")];
    if (lists.length < 2) return;
    const source = lists[0];
    for (const target of lists.slice(1)) target.innerHTML = source.innerHTML;
  }

  function renderCharts(points) {
    const values = points.map((point) => point?.value).filter((value) => typeof value === "number" && Number.isFinite(value));
    const targets = [...root.querySelectorAll("[data-simple-equity-chart]")];
    if (values.length < 2) return;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const coordinates = values.map((value, index) => `${16 + index / (values.length - 1) * 768},${164 - (value - min) / range * 148}`).join(" ");
    for (const target of targets) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 800 180");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Paper 계정 자산 추이");
      const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      polyline.setAttribute("fill", "none");
      polyline.setAttribute("stroke", "currentColor");
      polyline.setAttribute("stroke-width", "3");
      polyline.setAttribute("points", coordinates);
      svg.append(polyline);
      target.replaceChildren(svg);
    }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "contrast" ? "contrast" : "dark";
  }

  function applyThemeFromControl() {
    const control = root.querySelector("[data-simple-setting='theme']");
    if (!control) return;
    applyTheme(control.value);
  }

  const chartPoints = [];
  const unsubscribers = [];
  const api = global.nusa;
  if (typeof api?.onChartPoint === "function") {
    unsubscribers.push(api.onChartPoint((point) => {
      if (typeof point?.value !== "number" || !Number.isFinite(point.value)) return;
      chartPoints.push(point);
      if (chartPoints.length > 120) chartPoints.splice(0, chartPoints.length - 120);
      renderCharts(chartPoints);
    }));
  }
  if (typeof api?.onControl === "function") {
    unsubscribers.push(api.onControl(() => global.requestAnimationFrame(mirrorTimeline)));
  }

  const timelineObserver = new window.MutationObserver(() => mirrorTimeline());
  const firstTimeline = root.querySelector("[data-simple-log-list]");
  if (firstTimeline) timelineObserver.observe(firstTimeline, { childList: true, subtree: true, characterData: true });

  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-simple-nav]")) global.requestAnimationFrame(syncNavigation);
  });
  global.addEventListener("hashchange", () => {
    if (!normalizeLegacyRoute()) global.requestAnimationFrame(syncNavigation);
  });
  root.querySelector("[data-simple-setting='theme']")?.addEventListener("change", applyThemeFromControl);

  alignRuntimeLanguage();
  if (!normalizeLegacyRoute()) syncNavigation();
  global.setTimeout(applyThemeFromControl, 0);
  global.setTimeout(mirrorTimeline, 0);
  if (typeof global.nusaApp?.settings === "function") {
    Promise.resolve(global.nusaApp.settings())
      .then((payload) => applyTheme((payload?.settings || payload)?.theme))
      .catch(() => {});
  }

  global.addEventListener("beforeunload", () => {
    timelineObserver.disconnect();
    unsubscribers.forEach((unsubscribe) => { try { unsubscribe?.(); } catch { /* best effort */ } });
  });
})(window);
