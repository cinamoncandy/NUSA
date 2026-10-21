const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const read = (f) => fs.readFileSync(`apps/mobile/src/${f}`, "utf8").replace(/\r\n/g, "\n");

test("the futures tab shows made-up numbers only behind an explicit, labelled preview that is off by default", () => {
  const view = read("futuresView.tsx");
  assert.match(view, /useState\(false\)/, "preview starts off");
  assert.match(view, /const source = preview \? FUTURES_SAMPLE_SNAPSHOT : futures;/);
  assert.match(view, /testID="futures-preview-banner"/);
  assert.match(view, /예시 데이터 · 실제 거래가 아니에요/);
  assert.match(read("futuresSample.ts"), /ONLY by the "예시 화면 보기" preview/);
  assert.doesNotMatch(fs.readFileSync("apps/mobile/App.tsx", "utf8"), /FUTURES_SAMPLE_SNAPSHOT/, "App never feeds the sample to the screen");
  assert.match(view, /testID="futures-reasons-empty"/, "no recorded reasons is stated, not guessed");
});
