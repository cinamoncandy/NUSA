(function attachComponentLibrary(global) {
  "use strict";

  function elementById(id) {
    return typeof id === "string" ? document.getElementById(id) : null;
  }

  function openDialog(id) {
    const dialog = elementById(id);
    if (!(dialog instanceof HTMLDialogElement)) return false;
    if (!dialog.open) dialog.showModal();
    return true;
  }

  function closeDialog(id) {
    const dialog = elementById(id);
    if (!(dialog instanceof HTMLDialogElement)) return false;
    if (dialog.open) dialog.close();
    return true;
  }

  function openDrawer(id) {
    const drawer = elementById(id);
    if (!drawer) return false;
    drawer.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    drawer.querySelector("[data-drawer-close]")?.focus();
    return true;
  }

  function closeDrawer(id) {
    const drawer = elementById(id);
    if (!drawer) return false;
    drawer.hidden = true;
    drawer.setAttribute("aria-hidden", "true");
    return true;
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-dialog-open], [data-dialog-close], [data-drawer-open], [data-drawer-close]") : null;
    if (!target) return;
    if (target.hasAttribute("data-dialog-open")) openDialog(target.getAttribute("data-dialog-open"));
    if (target.hasAttribute("data-dialog-close")) closeDialog(target.getAttribute("data-dialog-close"));
    if (target.hasAttribute("data-drawer-open")) openDrawer(target.getAttribute("data-drawer-open"));
    if (target.hasAttribute("data-drawer-close")) closeDrawer(target.closest(".ui-drawer")?.id);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".ui-drawer:not([hidden])").forEach((drawer) => closeDrawer(drawer.id));
  });

  global.NUSAComponents = Object.freeze({ closeDialog, closeDrawer, openDialog, openDrawer });
})(window);
