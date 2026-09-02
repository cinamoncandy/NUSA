(function mountCanonicalAdapter(global) {
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

  function mirrorFirst(selector) {
    const nodes = [...root.querySelectorAll(selector)];
    if (nodes.length < 2) return;
    const source = nodes[0];
    for (const target of nodes.slice(1)) target.innerHTML = source.innerHTML;
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === "contrast" ? "contrast" : "dark";
  }

  const timeline = root.querySelector("[data-simple-log-list]");
  const chart = root.querySelector("[data-simple-equity-chart]");
  const timelineObserver = new global.MutationObserver(() => mirrorFirst("[data-simple-log-list]"));
  const chartObserver = new global.MutationObserver(() => mirrorFirst("[data-simple-equity-chart]"));
  if (timeline) timelineObserver.observe(timeline, { childList: true, subtree: true, characterData: true });
  if (chart) chartObserver.observe(chart, { childList: true, subtree: true, characterData: true });

  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-simple-nav]")) global.requestAnimationFrame(syncNavigation);
  });
  global.addEventListener("hashchange", () => {
    if (!normalizeLegacyRoute()) global.requestAnimationFrame(syncNavigation);
  });
  root.querySelector("[data-simple-setting='theme']")?.addEventListener("change", (event) => applyTheme(event.currentTarget.value));

  if (!normalizeLegacyRoute()) syncNavigation();
  global.setTimeout(() => mirrorFirst("[data-simple-log-list]"), 0);
  global.setTimeout(() => mirrorFirst("[data-simple-equity-chart]"), 0);
  if (typeof global.nusaApp?.settings === "function") {
    Promise.resolve(global.nusaApp.settings())
      .then((payload) => applyTheme((payload?.settings || payload)?.theme))
      .catch(() => {});
  }

  global.addEventListener("beforeunload", () => {
    timelineObserver.disconnect();
    chartObserver.disconnect();
  });
})(window);
