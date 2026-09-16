const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const {
  applyRendererNavigationPolicy,
  browserWindowSecurityOptions,
  isAllowedRendererNavigation
} = require("../dist/apps/desktop/src/productionHardening.js");

const INDEX = "file:///C:/app/apps/desktop/renderer/index.html";

test("the renderer may only stay on the document it was loaded with", () => {
  assert.equal(isAllowedRendererNavigation(INDEX, INDEX), true, "a reload of the same document is allowed");
  assert.equal(isAllowedRendererNavigation(INDEX, `${INDEX}#section`), true, "an in-page fragment is allowed");

  // The preload bridge is re-injected on every navigation, so remote content would receive it.
  assert.equal(isAllowedRendererNavigation(INDEX, "https://evil.example/"), false);
  assert.equal(isAllowedRendererNavigation(INDEX, "http://127.0.0.1:8787/mcp"), false);
  assert.equal(isAllowedRendererNavigation(INDEX, "data:text/html,<script>1</script>"), false);
  assert.equal(isAllowedRendererNavigation(INDEX, "javascript:alert(1)"), false);
  assert.equal(isAllowedRendererNavigation(INDEX, "file:///C:/Windows/System32/drivers/etc/hosts"), false);
  assert.equal(isAllowedRendererNavigation(INDEX, `${INDEX}?next=https://evil.example`), false);
  assert.equal(isAllowedRendererNavigation(INDEX, "not a url"), false);
});

test("navigation policy blocks navigation, new windows, and webview attachment", () => {
  const listeners = new Map();
  const blocked = [];
  let openHandler;
  const contents = {
    getURL: () => INDEX,
    on: (event, listener) => { listeners.set(event, listener); },
    setWindowOpenHandler: (handler) => { openHandler = handler; }
  };
  applyRendererNavigationPolicy(contents, (reason, url) => blocked.push({ reason, url }));

  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };

  listeners.get("will-navigate")(event, INDEX);
  assert.equal(prevented, false, "staying on the same document is not blocked");
  assert.deepEqual(blocked, []);

  listeners.get("will-navigate")(event, "https://evil.example/");
  assert.equal(prevented, true, "navigation to remote content is prevented");
  assert.deepEqual(blocked.at(-1), { reason: "WILL_NAVIGATE", url: "https://evil.example/" });

  prevented = false;
  listeners.get("will-attach-webview")(event);
  assert.equal(prevented, true, "webview attachment is prevented");
  assert.equal(blocked.at(-1).reason, "WILL_ATTACH_WEBVIEW");

  assert.deepEqual(openHandler({ url: "https://evil.example/" }), { action: "deny" });
  assert.equal(blocked.at(-1).reason, "WINDOW_OPEN");
});

test("window security options keep isolation and disable webview", () => {
  const options = browserWindowSecurityOptions({ devToolsEnabled: false, maximumLogLevel: "INFO" });
  assert.equal(options.contextIsolation, true);
  assert.equal(options.nodeIntegration, false);
  assert.equal(options.sandbox, true);
  assert.equal(options.webSecurity, true);
  assert.equal(options.webviewTag, false);
});

test("the policy is registered for every webContents, not one window", () => {
  const main = readFileSync("apps/desktop/src/main.ts", "utf8");
  assert.match(main, /app\.on\("web-contents-created"/);
  assert.match(main, /applyRendererNavigationPolicy\(contents/);
});
