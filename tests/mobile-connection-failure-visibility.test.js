const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "apps/mobile/src/settingsView.tsx"), "utf8");

// The connection summary carries the reason, but it renders several rows above the step list.
// An operator looking at the ERROR badge on VERIFY saw only that step's static description and
// had to know to scroll back for the cause, which is why a real failure went undiagnosed.
test("the failing connection step shows the reason beside its own badge", () => {
  assert.match(source, /errorDetail\?: string/, "a step can carry a failure reason");
  assert.match(
    source,
    /errorDetail \? <Text[^>]*styles\.connectionError[^>]*testID="settings-connection-step-error">\{errorDetail\}<\/Text> : null/,
    "the reason renders inside the step when present"
  );
  assert.match(source, /title="VERIFY"[^/]*errorDetail: connection\.reason/, "VERIFY carries the reason when the connection failed");
});

test("the reason is only shown on a failed connection", () => {
  assert.match(source, /\{\.\.\.\(connectionFailed \? \{ errorDetail: connection\.reason \} : \{\}\)\}/);
  // A step with no reason renders nothing extra rather than an empty line.
  assert.match(source, /errorDetail \? <Text/);
});

test("the step reason is styled as a failure, not as ordinary detail", () => {
  assert.match(source, /connectionError: \{[^}]*fontWeight: "700"/);
  assert.match(source, /styles\.connectionError, \{ color: theme\.colors\.danger \}/);
});

// The summary notice stays: it is what reports a healthy connection and the neutral
// pre-connection state, neither of which belongs on a step badge.
test("the connection summary notice is preserved", () => {
  assert.match(source, /testID="settings-connection-summary"/);
  assert.match(source, /cloudConnectionDetail/);
});
