(function registerCanonicalAdapter(global) {
  "use strict";

  // Reserved extension seam. Navigation, themes, charts, timelines and runtime
  // subscriptions are owned by app-runtime.js; this adapter stays presentation-only.
  function attachTradingUxStylesheet() {
    const doc = global.document;
    if (!doc || doc.querySelector('link[data-nusa-trading-ux="canonical"]')) return;

    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = "trading-ux.css";
    link.setAttribute("data-nusa-trading-ux", "canonical");
    doc.head.append(link);
  }

  attachTradingUxStylesheet();

  global.NUSACanonicalAdapter = Object.freeze({
    version: 2,
    presentationLayer: "trading-ux"
  });
})(window);
