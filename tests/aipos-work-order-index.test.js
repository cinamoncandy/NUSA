"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { check, classify, render } = require("../scripts/aipos-work-order-index.js");

const root = path.resolve(__dirname, "..");

test("new work orders use canonical statuses", () => {
  const result = check(root);
  assert.deepEqual(result.failures, [], "use a canonical status (see scripts/aipos-work-order-index.js)");
});

test("an unfamiliar status is treated as open so it can never hide work", () => {
  assert.equal(classify("SOMETHING_NEW"), "open");
  assert.equal(classify("IN_PROGRESS"), "open");
  assert.equal(classify("COMPLETED"), "closed");
  assert.equal(classify("VERIFIED"), "closed");
});

test("the index lists open orders and omits closed ones", () => {
  const text = render([
    { name: "a.yaml", id: "WO-OPEN", title: "open one", status: "IN_PROGRESS" },
    { name: "b.yaml", id: "WO-DONE", title: "done one", status: "COMPLETED" },
  ]);
  assert.match(text, /WO-OPEN/);
  assert.doesNotMatch(text, /WO-DONE/);
  assert.match(text, /open: 1 · closed: 1/);
});
