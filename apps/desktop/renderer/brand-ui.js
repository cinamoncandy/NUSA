(function mountDokkaebiBrandUI(global) {
  "use strict";

  const document = global.document;
  const byId = (id) => document.getElementById(id);
  const STATUS_PRESENTATION = Object.freeze({
    PASS: ["정상", "검증을 통과했습니다"], RUNNING: ["실행 중", "관측이 진행 중입니다"], SHADOW: ["Shadow", "실제 주문 없이 관측합니다"],
    RECONNECTING: ["재연결 중", "시장 데이터를 다시 연결하고 있습니다"], RECOVERED: ["복구됨", "연결이 복구되었습니다"], CHECK_REQUIRED: ["확인 필요", "추가 확인이 필요합니다"],
    HALT: ["중지됨", "안전상 실행이 차단되었습니다"], REJECT: ["거부됨", "요청이 안전 기준에 맞지 않습니다"], BLOCKED: ["차단됨", "사전 조건을 충족하지 못했습니다"],
    COMPLETED: ["완료", "세션이 정상적으로 종료되었습니다"], RECOVERY_REQUIRED: ["복구 필요", "이전 실행을 확인해야 합니다"], MATCHED: ["일치", "상태 대조가 일치합니다"],
    MISMATCHED: ["불일치", "상태 대조가 일치하지 않습니다"], ERROR: ["오류", "오류가 발생했습니다"], NOT_RUN: ["미실행", "아직 실행되지 않았습니다"], "N/A": ["해당 없음", "사용할 수 없는 상태입니다"]
  });

  function statusPresentation(code) {
    const value = STATUS_PRESENTATION[String(code)] || [String(code || "알 수 없음"), "상태 설명을 확인할 수 없습니다"];
    return Object.freeze({ code: String(code || "N/A"), label: value[0], description: value[1] });
  }

  function installCopyButtons() {
    document.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-copy-value]");
      if (!button) return;
      const value = button.getAttribute("data-copy-value");
      if (!value || !global.navigator?.clipboard?.writeText) return;
      void global.navigator.clipboard.writeText(value).then(() => {
        const original = button.textContent;
        button.textContent = "복사됨";
        global.setTimeout(() => { button.textContent = original; }, 1200);
      });
    });
  }

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
        for (const candidate of items) {
          const active = candidate === item;
          candidate.classList.toggle("is-active", active);
          if (active) candidate.setAttribute("aria-current", "page"); else candidate.removeAttribute("aria-current");
        }
        global.history.replaceState(null, "", `#${item.dataset.navTarget}`);
      });
    }
  }

  assignSectionIds();
  wireNavigation();
  installCopyButtons();
  global.DokkaebiBrandUI = Object.freeze({ statusPresentation, statuses: STATUS_PRESENTATION });
})(window);
