const test = require("node:test");
const assert = require("node:assert/strict");
const { validate } = require("../scripts/validate-research-architecture.js");
test("research architecture guard enforces one owner promotion path and hardened evidence", () => { const result = validate(process.cwd()); assert.equal(result.ok, true, result.failures.join(",")); });
