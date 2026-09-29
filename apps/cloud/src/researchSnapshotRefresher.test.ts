import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { RESEARCH_REFRESH_RECORD_FILE, ResearchSnapshotRefresher } from "./researchSnapshotRefresher";

function harness(startAt = 1_000) {
  const dir = mkdtempSync(path.join(tmpdir(), "nusa-refresh-"));
  let now = startAt;
  const spawned: Array<{ command: string; args: readonly string[]; child: EventEmitter & { kill: () => boolean; killed: boolean } }> = [];
  const make = () => new ResearchSnapshotRefresher({
    cloudStateDbPath: path.join(dir, "state.sqlite"),
    cwd: "/opt/nusa/current",
    executable: "/usr/bin/node",
    env: { NUSA_MODE: "PAPER" },
    now: () => now,
    minIntervalMs: 100,
    spawn: (command, args) => {
      const child = Object.assign(new EventEmitter(), { killed: false, kill() { this.killed = true; return true; } });
      spawned.push({ command, args, child });
      return child as never;
    },
  });
  return { dir, spawned, make, advance: (ms: number) => { now += ms; } };
}

test("runs the canonical Research entrypoint once and never concurrently", () => {
  const { spawned, make } = harness();
  const refresher = make();
  assert.equal(refresher.requestIfDue(), "STARTED");
  assert.equal(refresher.requestIfDue(), "RUNNING");
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0]!.command, "/usr/bin/node");
  assert.deepEqual(spawned[0]!.args, [path.join("/opt/nusa/current", "scripts", "run-cloud-research-snapshot.js")]);
});

test("is rate limited across restarts and records the outcome", () => {
  const { dir, spawned, make, advance } = harness();
  const first = make();
  first.requestIfDue();
  spawned[0]!.child.emit("exit", 1);
  const record = JSON.parse(readFileSync(path.join(dir, RESEARCH_REFRESH_RECORD_FILE), "utf8"));
  assert.equal(record.status, "FAILED");
  const restarted = make();
  assert.equal(restarted.requestIfDue(), "NOT_DUE", "a restart must not re-run Research immediately");
  advance(100);
  assert.equal(restarted.requestIfDue(), "STARTED");
  spawned[1]!.child.emit("exit", 0);
  assert.equal(JSON.parse(readFileSync(path.join(dir, RESEARCH_REFRESH_RECORD_FILE), "utf8")).status, "COMPLETED");
});

test("a spawn failure never throws and stop terminates a running refresh", () => {
  const unavailable = new ResearchSnapshotRefresher({ cloudStateDbPath: ":memory:" });
  assert.equal(unavailable.requestIfDue(), "UNAVAILABLE");
  const { dir } = harness();
  const throwing = new ResearchSnapshotRefresher({ cloudStateDbPath: path.join(dir, "state.sqlite"), spawn: () => { throw new Error("EAGAIN"); } });
  assert.equal(throwing.requestIfDue(), "UNAVAILABLE");
  const { spawned, make } = harness();
  const refresher = make();
  refresher.requestIfDue();
  refresher.stop();
  assert.equal(spawned[0]!.child.killed, true);
  assert.equal(refresher.requestIfDue(), "UNAVAILABLE");
});
