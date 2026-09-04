const test = require("node:test");
const assert = require("node:assert/strict");
const { loadOperatorUsers } = require("../dist/apps/mobile/src/operatorUserAccessClient.js");

const record = (overrides = {}) => ({
  id: "user-1",
  email: "user@nusa.local",
  role: "USER",
  status: "ACTIVE",
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
});

function stubFetch(payload, status = 200) {
  const realFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify(payload), { status });
  return () => { global.fetch = realFetch; };
}

test("valid snapshots pass through frozen", async () => {
  const restore = stubFetch({ users: [record(), record({ id: "owner", role: "OWNER" })] });
  try {
    const snapshot = await loadOperatorUsers("https://cloud.example.test", "token-123");
    assert.equal(snapshot.users.length, 2);
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.users));
  } finally { restore(); }
});

test("non-array user lists fail closed instead of rendering empty", async () => {
  for (const payload of [{}, { users: null }, { users: "none" }, { users: {} }]) {
    const restore = stubFetch(payload);
    try {
      await assert.rejects(() => loadOperatorUsers("https://cloud.example.test", "token-123"), /올바르지 않습니다/);
    } finally { restore(); }
  }
});

test("malformed records fail closed", async () => {
  for (const bad of [
    record({ id: "" }),
    record({ email: "" }),
    record({ role: "ADMIN" }),
    record({ status: "GHOST" }),
    record({ id: undefined }),
    "not-an-object",
    null,
  ]) {
    const restore = stubFetch({ users: [bad] });
    try {
      await assert.rejects(() => loadOperatorUsers("https://cloud.example.test", "token-123"), /올바르지 않습니다/);
    } finally { restore(); }
  }
});

test("HTTP errors and missing tokens reject with actionable messages", async () => {
  const restore = stubFetch({ error: "FORBIDDEN" }, 403);
  try {
    await assert.rejects(() => loadOperatorUsers("https://cloud.example.test", "token-123"), /FORBIDDEN/);
  } finally { restore(); }
  await assert.rejects(() => loadOperatorUsers("https://cloud.example.test", "   "), /토큰/);
});
