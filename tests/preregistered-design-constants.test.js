'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const doc = fs.readFileSync(path.join(__dirname, '..', 'docs/research-ledger/PREREGISTERED_STUDIES_2026-10-21.md'), 'utf8');

test('design document states the constants the code relies on', () => {
  for (const needle of ['0.0167', '100,000', '20261021', '60', '20 bp']) {
    assert.ok(doc.includes(needle), `design doc is missing ${needle}`);
  }
});

test('registered design hash matches the design file bytes (freeze)', () => {
  const { assertDesignFrozen } = require('../scripts/lib/preregisteredDesign.js');
  assert.doesNotThrow(() => assertDesignFrozen());
});

test('registered S5 design hash matches the S5 design file bytes (freeze)', () => {
  const { assertDesignFrozen, S5_DESIGN_FILE, S5_DESIGN_SHA256 } = require('../scripts/lib/preregisteredDesign.js');
  assert.doesNotThrow(() => assertDesignFrozen({ file: S5_DESIGN_FILE, expected: S5_DESIGN_SHA256 }));
});
