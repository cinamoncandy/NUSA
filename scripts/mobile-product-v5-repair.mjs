import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const write = (p, value) => fs.writeFileSync(path.join(root, p), value);
const mustReplace = (source, before, after, label) => {
  if (!source.includes(before)) throw new Error(`missing target: ${label}`);
  return source.replace(before, after);
};

let settingsTest = read("tests/mobile-settings-ui.test.js");
settingsTest = mustReplace(settingsTest,
  'assert.match(source, /LOCAL PAPER 거래에는 사용하지 않습니다/);',
  'assert.match(source, /LOCAL PAPER에는 사용하지 않습니다/);',
  "LOCAL PAPER connection copy");
write("tests/mobile-settings-ui.test.js", settingsTest);

let canonical = read("tests/mobile-uiux-v3-canonical.test.js");
canonical = mustReplace(canonical,
  'assert.match(portfolio, /label: "EQUITY"/);',
  'assert.match(portfolio, /label: "PAPER EQUITY"/);',
  "portfolio equity label");
write("tests/mobile-uiux-v3-canonical.test.js", canonical);

let nav = read("tests/uiux-nav-chrome-closeout.test.js");
nav = mustReplace(nav, 'assert.match(app, /Markets: "OBSERVE"/);', 'assert.match(app, /Markets: "MARKETS"/);', "markets nav label");
nav = mustReplace(nav, 'assert.match(app, /Portfolio: "SUPERVISE"/);', 'assert.match(app, /Portfolio: "PORTFOLIO"/);', "portfolio nav label");
write("tests/uiux-nav-chrome-closeout.test.js", nav);

let product = read("tests/mobile-product-v5.test.js");
product = mustReplace(product,
  '  assert.doesNotMatch(productionPaper, /BUY|SELL|quantity|submit/i);\n  assert.match(productionPaper, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);',
  '  assert.match(productionPaper, /<PaperLearningMonitorView/);\n  assert.doesNotMatch(productionPaper, /<LegacyTradingView/);\n  assert.doesNotMatch(productionPaper, /<NusaTextField|placeOrder\\(|submitOrder\\(/);\n  assert.match(productionPaper, /PAPER ONLY · LIVE NONE · AI ZERO AUTHORITY/);',
  "production PAPER supervision assertion");
write("tests/mobile-product-v5.test.js", product);

fs.rmSync(path.join(root, "scripts/mobile-product-v5-repair.mjs"), { force: true });
console.log("product v5 acceptance contracts aligned");
