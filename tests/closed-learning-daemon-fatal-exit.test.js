"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const compiled = fs.readFileSync(path.join(root, "dist/apps/cloud/src/closedLearningProductionRuntime.js"), "utf8");
const main = compiled.match(/function main\(\) \{[\s\S]*?\r?\n\}/)?.[0];
assert.ok(main, "exercise the actual compiled daemon entrypoint");
const runtimeBinding = main.match(/\(0, (\w+)\.registerGracefulShutdown\)/)?.[1];
assert.ok(runtimeBinding, "bind the actual compiler-generated runtime import");
const fatalHandler = compiled.match(/const failClosedScheduler = ([\s\S]*?);\r?\n\s*const scheduleTick/)?.[1];
assert.ok(fatalHandler, "exercise the actual scheduler failure handler too");
const failureBinding = fatalHandler.match(/\(0, (\w+)\.recordRuntimeFailure\)/)?.[1];
assert.ok(failureBinding);

for (const mode of ["fatal", "fatal-repeat", "fatal-stop-rejects", "signal"]) {
  test(`daemon bounded shutdown exits despite residual handles (${mode})`, () => {
    const script = `
      const ${runtimeBinding} = require('./dist/apps/cloud/src/runtime.js');
      const ${failureBinding} = { recordRuntimeFailure: () => console.log('FAILURE_RECORDED') };
      function startClosedLearningProductionRuntime(_env, onSchedulerFailure) {
        const handle = { stop: async () => {
          console.log('STOP_INVOKED');
          if (${JSON.stringify(mode)} === 'fatal-stop-rejects') throw new Error('FIXTURE_STOP_FAILED');
        } };
        const config = { cloudStateDbPath: ':memory:' };
        const requestFatalShutdown = onSchedulerFailure;
        const failClosedScheduler = ${fatalHandler};
        setTimeout(() => {
          if (${JSON.stringify(mode)} === 'signal') process.emit('SIGTERM');
          else {
            console.log('SCHEDULER_FATAL');
            failClosedScheduler(new Error('PAPER_WRITER_LEASE_LOST'));
            if (${JSON.stringify(mode)} === 'fatal-repeat') failClosedScheduler(new Error('PAPER_WRITER_LEASE_LOST'));
          }
        }, 0);
        return { handle };
      }
      setInterval(() => {}, 1000);
      ${main}
      main();
    `;
    const child = spawnSync(process.execPath, ["-e", script], { cwd: root, encoding: "utf8", timeout: 8000 });
    assert.ifError(child.error);
    assert.equal(child.signal, null);
    assert.match(child.stdout, /STOP_INVOKED/, `must enter canonical cleanup, not merely crash in the harness: ${child.stderr}`);
    assert.equal(child.status, mode === "signal" ? 0 : 1, child.stderr);
    assert.equal((child.stdout.match(/STOP_INVOKED/g) || []).length, 1, "one canonical cleanup despite repeated failures");
    if (mode !== "signal") {
      assert.match(child.stdout, /SCHEDULER_FATAL/);
      assert.ok(child.stdout.indexOf('FAILURE_RECORDED') < child.stdout.indexOf('STOP_INVOKED'), "record failure before cleanup");
    }
  });
}
