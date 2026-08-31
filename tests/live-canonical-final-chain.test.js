'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LiveExecutionConsumeOnce,
} = require('../dist/apps/cloud/src/liveExecutionConsumeOnce.js');
const {
  LiveRuntimeSessionDurableStore,
} = require('../dist/apps/cloud/src/liveRuntimeSessionDurableStore.js');
const {
  submitAuthoritativeSessionBoundLiveOrder,
} = require('../dist/apps/cloud/src/liveSessionBrokerAdapterBoundary.js');

class SerializedStorage {
  constructor() {
    this.values = new Map();
    this.tail = Promise.resolve();
  }

  async transaction(callback) {
    let release;
    const previous = this.tail;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await callback({
        get: async (key) => this.values.get(key),
        put: async (key, value) => { this.values.set(key, value); },
      });
    } finally {
      release();
    }
  }
}

const activeSession = Object.freeze({
  sessionId: 'session-1',
  ownerPrincipalId: 'owner-1',
  investmentCapitalWeight: 0.25,
  state: 'ACTIVE',
  killSwitchEngaged: false,
  activatedAtMs: 900,
  expiresAtMs: 2_000,
});

function request(overrides = {}) {
  return {
    ownerPrincipalId: 'owner-1',
    policyOwnerPrincipalId: 'owner-1',
    market: 'BTC-USD',
    side: 'BUY',
    requestedNotionalUsd: 100,
    totalEquityUsd: 1_000,
    riskApprovedNotionalUsd: 200,
    riskDecision: 'ALLOW',
    tradingAllowed: true,
    overallHealth: 'HEALTHY',
    marketTrusted: true,
    observedAt: 1_000,
    decidedAt: 1_000,
    now: 1_100,
    ...overrides,
  };
}

async function setup(Store = LiveRuntimeSessionDurableStore) {
  const storage = new SerializedStorage();
  const store = new Store(storage);
  const stored = await store.write(activeSession, null);
  assert.equal(stored.status, 'STORED');
  return { store, consumeOnce: new LiveExecutionConsumeOnce(storage) };
}

class RecordingTransport {
  constructor() {
    this.requests = [];
  }

  async submit(requestValue) {
    this.requests.push(requestValue);
    return { accepted: false, reason: 'TEST_TRANSPORT_NO_MUTATION' };
  }
}

class ThrowingTransport {
  constructor() {
    this.calls = 0;
  }

  async submit() {
    this.calls += 1;
    throw new Error('TEST_TRANSPORT_OUTCOME_UNKNOWN');
  }
}

class RevisionChangingStore extends LiveRuntimeSessionDurableStore {
  constructor(storage) {
    super(storage);
    this.reads = 0;
  }

  async read(ownerPrincipalId) {
    const record = await super.read(ownerPrincipalId);
    this.reads += 1;
    if (record && this.reads === 1) {
      const changed = await this.write({ ...record.session, investmentCapitalWeight: 0.20 }, record.revision);
      assert.equal(changed.status, 'STORED');
    }
    return record;
  }
}

test('authoritative final chain uses the persisted session and reaches only the injected transport', async () => {
  const { store, consumeOnce } = await setup();
  const transport = new RecordingTransport();
  const result = await submitAuthoritativeSessionBoundLiveOrder(request(), store, consumeOnce, transport);

  assert.deepEqual(result, {
    status: 'SUBMITTED',
    result: { accepted: false, reason: 'TEST_TRANSPORT_NO_MUTATION' },
  });
  assert.equal(transport.requests.length, 1);
  assert.deepEqual(transport.requests[0], {
    ownerId: 'owner-1',
    market: 'BTC-USD',
    side: 'buy',
    notional: 100,
    fingerprint: transport.requests[0].fingerprint,
  });
  assert.match(transport.requests[0].fingerprint, /^[a-f0-9]{64}$/);
});

test('concurrent authoritative requests reserve and reach the transport at most once', async () => {
  const { store, consumeOnce } = await setup();
  const transport = new RecordingTransport();
  const results = await Promise.all(Array.from({ length: 8 }, () => submitAuthoritativeSessionBoundLiveOrder(request(), store, consumeOnce, transport)));

  assert.equal(results.filter((result) => result.status === 'SUBMITTED').length, 1);
  assert.equal(results.filter((result) => result.status === 'REJECTED').length, 7);
  assert.equal(transport.requests.length, 1);
});

test('a persisted session revision change after preparation blocks transport access', async () => {
  const { store, consumeOnce } = await setup(RevisionChangingStore);
  const transport = new RecordingTransport();
  const result = await submitAuthoritativeSessionBoundLiveOrder(request(), store, consumeOnce, transport);

  assert.deepEqual(result, { status: 'REJECTED', reason: 'SESSION_REVISION_CHANGED' });
  assert.equal(transport.requests.length, 0);
});

test('an unknown transport outcome cannot be retried into a second transport call', async () => {
  const { store, consumeOnce } = await setup();
  const transport = new ThrowingTransport();

  await assert.rejects(
    submitAuthoritativeSessionBoundLiveOrder(request(), store, consumeOnce, transport),
    /TEST_TRANSPORT_OUTCOME_UNKNOWN/,
  );
  const retry = await submitAuthoritativeSessionBoundLiveOrder(request(), store, consumeOnce, transport);

  assert.deepEqual(retry, { status: 'REJECTED', reason: 'SESSION_CHAIN_REJECTED' });
  assert.equal(transport.calls, 1);
});

test('storage failure is fail-closed before the transport boundary', async () => {
  const unavailable = {
    async transaction() {
      throw new Error('TEST_STORAGE_UNAVAILABLE');
    },
  };
  const store = new LiveRuntimeSessionDurableStore(unavailable);
  const consumeOnce = new LiveExecutionConsumeOnce(unavailable);
  const transport = new RecordingTransport();

  const result = await submitAuthoritativeSessionBoundLiveOrder(request(), store, consumeOnce, transport);

  assert.deepEqual(result, { status: 'REJECTED', reason: 'AUTHORITATIVE_SESSION_UNAVAILABLE' });
  assert.equal(transport.requests.length, 0);
});

function collectProductionSources(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...collectProductionSources(absolute));
    else if (/\.(?:ts|js)$/.test(entry.name) && !/\.(?:test|vitest)\.(?:ts|js)$/.test(entry.name)) result.push(absolute);
  }
  return result;
}

test('legacy direct broker boundary remains unreachable from production source', () => {
  const repositoryRoot = path.resolve(__dirname, '..');
  const productionRoots = [
    path.join(repositoryRoot, 'apps', 'cloud', 'src'),
    path.join(repositoryRoot, 'apps', 'desktop', 'src'),
    path.join(repositoryRoot, 'apps', 'execution', 'src'),
    path.join(repositoryRoot, 'packages'),
  ];
  const importPattern = /(?:from\s+|require\(\s*)["'][^"']*liveExecutionBoundary(?:\.(?:ts|js))?["']/;
  const offenders = productionRoots
    .flatMap((root) => fs.existsSync(root) ? collectProductionSources(root) : [])
    .filter((file) => importPattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(repositoryRoot, file));

  assert.deepEqual(offenders, []);
  const canonicalSource = fs.readFileSync(path.join(repositoryRoot, 'apps', 'cloud', 'src', 'liveSessionBrokerAdapterBoundary.ts'), 'utf8');
  assert.match(canonicalSource, /submitAuthoritativeSessionBoundLiveOrder/);
  assert.match(canonicalSource, /reserveFinalExecution/);
  assert.match(canonicalSource, /transport\.submit/);
});
