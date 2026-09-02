(function registerCanonicalAdapter(global) {
  "use strict";

  // Reserved zero-authority extension seam. Navigation, themes, charts, timelines and
  // runtime subscriptions remain owned by app-runtime.js. This adapter may mount
  // presentation-only assets but must never read or mutate trading/runtime state.
  const document = global.document;
  if (document && !document.querySelector('link[data-nusa-cockpit-premium="canonical"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "cockpit-premium.css";
    link.dataset.nusaCockpitPremium = "canonical";
    document.head.append(link);
  }

  global.NUSACanonicalAdapter = Object.freeze({
    version: 2,
    presentationLayer: "cockpit-premium"
  });
})(window);
