(function registerCanonicalAdapter(global) {
  "use strict";
  // Reserved extension seam. Navigation, themes, charts, timelines and runtime
  // subscriptions are owned by app-runtime.js; this file must not duplicate them.
  global.NUSACanonicalAdapter = Object.freeze({ version: 1 });
})(window);
