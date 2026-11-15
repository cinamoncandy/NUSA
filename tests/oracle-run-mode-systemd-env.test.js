"use strict";
// Review of PR #3136 (P0 and P2): the helper's `start` must never accept an env file that SYSTEMD would read differently from the way the helper read it.
// The unit reads /etc/nusa/cloud-runtime.env with EnvironmentFile=, which is not a shell: quotes may span lines, a backslash escapes or continues, `#` and `;`
// start comments, a line that is not a valid KEY=VALUE is ignored, and the LAST assignment wins. The dangerous direction is a file the helper reads as
// NUSA_PAPER_ORDER_PATH=OFF while systemd leaves the variable unset (the runtime reads unset as ON, i.e. the order path).
// SOUNDNESS PROPERTY tested on thousands of generated files: if runtime_order_path_value (the real bash function from the helper) returns OFF, a
// reference model of systemd's parser must also give OFF. The model is written from the documented behaviour of EnvironmentFile= (systemd.exec(5)); it is a
// model, not systemd itself, and says so: a real-systemd check on the host is listed as unverified in the PR.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(root, "deploy", "oracle", "nusa-release-step.sh"), "utf8").replace(/\r\n/g, "\n");
const posixOnly = process.platform === "win32" ? { skip: "the release helper runs only on the Linux host" } : {};

function extractFunction(name) {
  const start = script.indexOf(`\n${name}() {`);
  assert.ok(start > 0, `${name} exists`);
  const end = script.indexOf("\n}\n", start);
  return script.slice(start, end + 3);
}

/** A model of systemd's EnvironmentFile= parser (systemd.exec(5)). Returns the Map of valid assignments; the last one wins. */
function systemdEnv(text) {
  const env = new Map();
  const NL = "\n\r";
  const WS = " \t";
  let state = "PRE_KEY";
  let key = "";
  let value = "";
  const store = () => {
    const k = key.replace(/[ \t]+$/, "");
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) env.set(k, value.replace(/[ \t]+$/, ""));
    key = ""; value = "";
  };
  for (const c of text) {
    switch (state) {
      case "PRE_KEY":
        if (NL.includes(c) || WS.includes(c)) break;
        if (c === "#" || c === ";") { state = "COMMENT"; break; }
        key = c; state = "KEY"; break;
      case "KEY":
        if (NL.includes(c)) { key = ""; state = "PRE_KEY"; } else if (c === "=") state = "PRE_VALUE"; else key += c;
        break;
      case "PRE_VALUE":
        if (NL.includes(c)) { store(); state = "PRE_KEY"; } else if (WS.includes(c)) break; else if (c === "'") state = "SQ"; else if (c === '"') state = "DQ"; else if (c === "\\") state = "VALUE_ESCAPE"; else { value = c; state = "VALUE"; }
        break;
      case "VALUE":
        if (NL.includes(c)) { store(); state = "PRE_KEY"; } else if (c === "\\") state = "VALUE_ESCAPE"; else if (c === "'") state = "SQ"; else if (c === '"') state = "DQ"; else value += c;
        break;
      case "VALUE_ESCAPE":
        if (!NL.includes(c)) value += c;
        state = "VALUE"; break;
      case "SQ":
        if (c === "'") state = "VALUE"; else value += c;
        break;
      case "DQ":
        if (c === '"') state = "VALUE"; else if (c === "\\") state = "DQ_ESCAPE"; else value += c;
        break;
      case "DQ_ESCAPE":
        if (!NL.includes(c)) value += c;
        state = "DQ"; break;
      case "COMMENT":
        if (NL.includes(c)) state = "PRE_KEY"; else if (c === "\\") state = "COMMENT_ESCAPE";
        break;
      case "COMMENT_ESCAPE":
        state = "COMMENT"; break;
      default: throw new Error(state);
    }
  }
  if (state === "VALUE" || state === "PRE_VALUE") store(); // an unterminated quote stores nothing
  return env;
}

test("the model reads the shapes that matter the way systemd documents them", () => {
  assert.equal(systemdEnv("NUSA_PAPER_ORDER_PATH=OFF\n").get("NUSA_PAPER_ORDER_PATH"), "OFF");
  assert.equal(systemdEnv("export NUSA_PAPER_ORDER_PATH=OFF\n").get("NUSA_PAPER_ORDER_PATH"), undefined, "a leading export is invalid and ignored");
  assert.equal(systemdEnv('NUSA_PAPER_ORDER_PATH="OFF"\n').get("NUSA_PAPER_ORDER_PATH"), "OFF");
  assert.equal(systemdEnv("NUSA_PAPER_ORDER_PATH=OFF\nNUSA_PAPER_ORDER_PATH=ON\n").get("NUSA_PAPER_ORDER_PATH"), "ON", "the last assignment wins");
  assert.equal(systemdEnv('FOO="a\\"b\nNUSA_PAPER_ORDER_PATH=OFF\n"\n').get("NUSA_PAPER_ORDER_PATH"), undefined, "an escaped quote keeps the string open and swallows the next line");
  assert.equal(systemdEnv("FOO=abc\\\nNUSA_PAPER_ORDER_PATH=OFF\n").get("NUSA_PAPER_ORDER_PATH"), undefined, "a trailing backslash continues the line");
  assert.equal(systemdEnv("# c\\\nNUSA_PAPER_ORDER_PATH=OFF\n").get("NUSA_PAPER_ORDER_PATH"), undefined, "a backslash continues a comment");
});

function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const FRAGMENTS = [
  "NUSA_PAPER_ORDER_PATH=OFF", "NUSA_PAPER_ORDER_PATH=OFF", "NUSA_PAPER_ORDER_PATH=OFF", "NUSA_PAPER_ORDER_PATH=ON", "export NUSA_PAPER_ORDER_PATH=OFF",
  ' NUSA_PAPER_ORDER_PATH=OFF', "NUSA_PAPER_ORDER_PATH = OFF", 'NUSA_PAPER_ORDER_PATH="OFF"', "NUSA_PAPER_ORDER_PATH='OFF'", "NUSA_PAPER_ORDER_PATH=OFF # c",
  "FOO=bar", "BAR=1", "X=$(id)", "# a comment", "; another comment", "# comment\\", "FOO=abc\\", "FOO=\\", 'FOO="a\\"b', 'FOO="a b"', "FOO='x y'",
  "FOO='x", 'FOO="x', '"', "'", "\"'\"'", 'FOO="\'"\'', "FOO=\"a'b'c\"", "A=b\\\\", "", "   ", "=", "NUSA_PAPER_ORDER_PATH=", "NUSA_PAPER_ORDER_PATH=OFFX",
];

const BENIGN = ["NUSA_PAPER_ORDER_PATH=OFF", "NUSA_PAPER_ORDER_PATH=OFF", "NUSA_PAPER_ORDER_PATH=ON", "FOO=bar", "BAR=1", "X=$(id)", "# a comment", "; another", "", "TOKEN=abc123def"];

test("SOUNDNESS: whenever the helper accepts a file as OFF, a model of systemd reads the variable as OFF too (3000 generated files)", posixOnly, () => {
  const rnd = mulberry32(20261115);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-env-fuzz-"));
  const files = [];
  try {
    for (let i = 0; i < 3000; i++) {
      const n = 1 + Math.floor(rnd() * 6);
      // Half the files are fully adversarial; half are ordinary files with at most one adversarial line, so many files are accepted and the property is not vacuous.
      const lines = rnd() < 0.5
        ? Array.from({ length: n }, () => FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)])
        : Array.from({ length: n }, () => BENIGN[Math.floor(rnd() * BENIGN.length)]);
      if (rnd() < 0.5) lines.splice(Math.floor(rnd() * (lines.length + 1)), 0, FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)]);
      const eol = rnd() < 0.1 ? "\r\n" : "\n";
      const text = lines.join(eol) + (rnd() < 0.8 ? eol : "");
      const file = path.join(dir, `f${i}.env`);
      fs.writeFileSync(file, text);
      files.push({ file, text });
    }
    const fnFile = path.join(dir, "fn.sh");
    fs.writeFileSync(fnFile, `${extractFunction("runtime_order_path_value")}\n`);
    const driver = 'source "$1"; shift; for f in "$@"; do v="$(runtime_order_path_value "$f" 2>/dev/null)" && printf "%s\\t%s\\n" "$f" "$v" || printf "%s\\tREFUSED\\n" "$f"; done';
    const r = spawnSync("bash", ["-c", driver, "_", fnFile, ...files.map((f) => f.file)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.status, 0, r.stderr);
    const byFile = new Map(r.stdout.trim().split("\n").map((l) => l.split("\t")));
    let accepted = 0;
    const violations = [];
    for (const { file, text } of files) {
      assert.ok(byFile.has(file), "every file got a verdict");
      if (byFile.get(file) !== "OFF") continue;
      accepted++;
      const seen = systemdEnv(text).get("NUSA_PAPER_ORDER_PATH");
      if (seen !== "OFF") violations.push({ text, systemdSees: seen });
    }
    assert.deepEqual(violations.slice(0, 3), [], `the helper accepted ${violations.length} file(s) that systemd reads differently`);
    assert.ok(accepted >= 300, `the corpus must contain many accepted files so the property is not vacuous (accepted ${accepted})`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
