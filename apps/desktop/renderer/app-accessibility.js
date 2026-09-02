(function mountCanonicalAccessibility(global) {
  "use strict";

  const document = global.document;
  const root = document?.getElementById("simple-ui-root");
  const sheet = root?.querySelector("[data-simple-sheet]");
  if (!document || !root || !sheet) return;

  const focusableSelector = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  function trapDialogFocus(event) {
    if (event.key !== "Tab" || sheet.hidden) return;
    const focusable = [...sheet.querySelectorAll(focusableSelector)].filter((node) => !node.hidden && node.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function syncBusyState() {
    const confirm = sheet.querySelector("[data-simple-sheet-confirm]");
    if (!confirm) return;
    if (sheet.hidden) {
      confirm.removeAttribute("aria-busy");
      confirm.disabled = false;
    }
  }

  const observer = new global.MutationObserver(syncBusyState);
  observer.observe(sheet, { attributes: true, attributeFilter: ["hidden"] });
  document.addEventListener("keydown", trapDialogFocus);
  global.addEventListener("beforeunload", () => {
    observer.disconnect();
    document.removeEventListener("keydown", trapDialogFocus);
  });
})(window);
