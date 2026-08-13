const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
test("Firebase readiness is deny-by-default and secret-free", () => {
  const config = JSON.parse(fs.readFileSync("firebase.json", "utf8"));
  const rules = fs.readFileSync("firestore.rules", "utf8");
  assert.equal(config.firestore.rules, "firestore.rules");
  assert.equal(config.firestore.indexes, "firestore.indexes.json");
  assert.match(rules, /allow delete: if false/);
  assert.match(rules, /allow update, delete: if false/);
  assert.match(rules, /match \/\{document=\*\*\} \{ allow read, write: if false; \}/);
  assert.doesNotMatch(rules, /private_key|serviceAccount|apiKey/i);
  assert.match(rules, /validUserStatus\(status\)/);
  assert.match(rules, /validAuditAction\(action\)/);
  assert.match(rules, /request\.resource\.data\.keys\(\)\.hasOnly\(\['role', 'status', 'email', 'displayName', 'createdAt', 'updatedAt'\]\)/);
  assert.match(rules, /request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\['status', 'updatedAt'\]\)/);
});
