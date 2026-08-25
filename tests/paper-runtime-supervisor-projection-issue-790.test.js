"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const projectionModule = "../dist/apps/cloud/src/paperRuntimeSupervisorProjection.js";

test("managed PAPER supervisor metadata projects read-only recovery evidence", () => {
  const { readPaperRuntimeSupervisorProjection } = require(projectionModule);
  const projection = readPaperRuntimeSupervisorProjection({
    NUSA_PAPER_SUPERVISOR_MANAGED: "true",
    NUSA_PAPER_SUPERVISOR_RESTART_ATTEMPT: "1",
    NUSA_PAPER_SUPERVISOR_RESTART_COUNT: "2",
    NUSA_PAPER_SUPERVISOR_STARTED_AT: "3000",
    NUSA_PAPER_SUPERVISOR_LAST_EXIT_CODE: "1",
    NUSA_PAPER_SUPERVISOR_LAST_EXIT_SIGNAL: "SIGKILL",
    NUSA_PAPER_SUPERVISOR_LAST_EXITED_AT: "2900",
    NUSA_PAPER_SUPERVISOR_LAST_UPTIME_MS: "500",
  });
  assert.deepEqual(projection, {
    managed: true,
    status: "RUNNING",
    restartAttempt: 1,
    restartCount: 2,
    startedAt: 3000,
    lastExit: { code: 1, signal: "SIGKILL", exitedAt: 2900, uptimeMs: 500 },
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
});

test("unmanaged or malformed supervisor metadata is not projected", () => {
  const { readPaperRuntimeSupervisorProjection } = require(projectionModule);
  assert.equal(readPaperRuntimeSupervisorProjection({}), undefined);
  assert.equal(readPaperRuntimeSupervisorProjection({
    NUSA_PAPER_SUPERVISOR_MANAGED: "true",
    NUSA_PAPER_SUPERVISOR_RESTART_ATTEMPT: "oops",
    NUSA_PAPER_SUPERVISOR_RESTART_COUNT: "0",
    NUSA_PAPER_SUPERVISOR_STARTED_AT: "1",
  }), undefined);
});
