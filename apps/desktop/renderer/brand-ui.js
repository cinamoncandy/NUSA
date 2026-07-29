(function mountDokkaebiBrandUI(global) {
  "use strict";

  const document = global.document;
  const byId = (id) => document.getElementById(id);

  function assignSectionIds() {
    const portfolio = document.querySelector(".grid .card:nth-child(3)");
    const recent = document.querySelector(".grid .card:nth-child(4)");
    const fills = byId("orders")?.closest("section");
    if (portfolio && !portfolio.id) portfolio.id = "portfolio";
    if (recent && !recent.id) recent.id = "recent-signals";
    if (fills && !fills.id) fills.id = "evidence";
    const shadow = byId("control-room");
    if (shadow && !shadow.id) shadow.id = "shadow-session";
    const risk = byId("a4-diagnostics");
    if (risk && !risk.dataset.navAlias) risk.dataset.navAlias = "risk diagnostics";
  }

  function wireNavigation() {
    const items = [...document.querySelectorAll("[data-nav-target]")];
    for (const item of items) {
      item.addEventListener("click", (event) => {
        const target = byId(item.dataset.navTarget) || document.querySelector(`[data-nav-alias~="${item.dataset.navTarget}"]`);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: global.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        for (const candidate of items) candidate.classList.toggle("is-active", candidate === item);
      });
    }
  }

  assignSectionIds();
  wireNavigation();
})(window);
