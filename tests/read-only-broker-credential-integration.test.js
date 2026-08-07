const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ElectronSafeStorageReadOnlyCredentialProvider } = require('../dist/apps/desktop/src/upbitReadOnlyCredentialProvider.js');
const { UpbitReadOnlyService } = require('../dist/apps/desktop/src/upbitReadOnlyService.js');
const { reconcileReadOnlySnapshots } = require('../dist/apps/desktop/src/upbitReadOnlyReconciliation.js');
const { UpbitApiError } = require('../dist/apps/desktop/src/upbitRestAdapter.js');
const { resolveUserDataLayout, protectedPaths } = require('../dist/apps/desktop/src/userDataLayout.js');
const { validate, buildEvidence } = require('../scripts/validate-read-only-broker-credential-integration.js');

function encryptedStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`cipher:${Buffer.from(value, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (value) => {
      const text = value.toString('utf8');
      if (!text.startsWith('cipher:')) throw new Error('bad ciphertext');
      return Buffer.from(text.slice(7), 'base64').toString('utf8');
    },
  };
}

function tempCredentialFile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nusa-readonly-'));
  return { root, file: path.join(root, 'credentials', 'upbit-read-only.enc') };
}

const snapshot = Object.freeze({
  observedAt: '2026-08-07T00:00:00.000Z',
  accounts: Object.freeze([{ currency: 'KRW', balance: '1000', locked: '0', avg_buy_price: '0', avg_buy_price_modified: false, unit_currency: 'KRW' }]),
  openOrders: Object.freeze([]),
});

test('credential provider persists ciphertext without raw secrets', async () => {
  const target = tempCredentialFile();
  const provider = new ElectronSafeStorageReadOnlyCredentialProvider(target.file, encryptedStorage());
  await provider.saveForReadOnlyUse({ accessKey: 'ACCESS-1234567890', secretKey: 'SECRET-0987654321' });
  const stored = fs.readFileSync(target.file, 'utf8');
  assert.doesNotMatch(stored, /ACCESS-1234567890|SECRET-0987654321/);
  const loaded = await provider.loadForReadOnlyUse();
  assert.equal(loaded.accessKey, 'ACCESS-1234567890');
  assert.equal(loaded.secretKey, 'SECRET-0987654321');
  fs.rmSync(target.root, { recursive: true, force: true });
});

test('credential status exposes only a masked access-key hint', async () => {
  const target = tempCredentialFile();
  const provider = new ElectronSafeStorageReadOnlyCredentialProvider(target.file, encryptedStorage());
  await provider.saveForReadOnlyUse({ accessKey: 'ACCESS-1234567890', secretKey: 'SECRET-0987654321' });
  const status = await provider.status();
  assert.equal(status.configured, true);
  assert.match(status.accessKeyHint, /^ACCE…7890$/);
  assert.doesNotMatch(JSON.stringify(status), /SECRET-0987654321/);
  fs.rmSync(target.root, { recursive: true, force: true });
});

test('credential provider fails closed when OS encryption is unavailable', async () => {
  const target = tempCredentialFile();
  const provider = new ElectronSafeStorageReadOnlyCredentialProvider(target.file, encryptedStorage(false));
  await assert.rejects(() => provider.saveForReadOnlyUse({ accessKey: 'ACCESS-1234567890', secretKey: 'SECRET-0987654321' }), /encryption unavailable/);
  assert.equal(await provider.loadForReadOnlyUse(), null);
  fs.rmSync(target.root, { recursive: true, force: true });
});

test('read-only service does not construct a broker adapter without credentials', async () => {
  let factoryCalls = 0;
  const provider = { status: async () => ({ configured: false, accessKeyHint: null, provider: 'electron-safe-storage' }), loadForReadOnlyUse: async () => null, saveForReadOnlyUse: async () => {}, deleteCredentials: async () => {} };
  const service = new UpbitReadOnlyService(provider, () => { factoryCalls += 1; throw new Error('must not construct'); });
  const result = await service.testConnection();
  assert.equal(result.code, 'NOT_CONFIGURED');
  assert.equal(factoryCalls, 0);
  assert.equal(typeof service.submitOrder, 'undefined');
  assert.equal(typeof service.cancelOrder, 'undefined');
  assert.equal(typeof service.withdraw, 'undefined');
});

test('read-only service captures snapshots through the read adapter port only', async () => {
  const provider = { status: async () => ({ configured: true, accessKeyHint: 'ACCE…7890', provider: 'electron-safe-storage' }), loadForReadOnlyUse: async () => ({ accessKey: 'ACCESS-1234567890', secretKey: 'SECRET-0987654321' }), saveForReadOnlyUse: async () => {}, deleteCredentials: async () => {} };
  const adapter = { getAccounts: async () => snapshot.accounts, getOrders: async () => [], getOpenOrders: async () => [], getOrder: async () => { throw new Error('unused'); }, getOrderChance: async () => { throw new Error('unused'); }, captureSnapshot: async () => snapshot };
  const service = new UpbitReadOnlyService(provider, () => adapter);
  const result = await service.captureSnapshot();
  assert.equal(result.ok, true);
  assert.equal(result.code, 'CONNECTED');
  assert.deepEqual(result.data, snapshot);
});

test('provider failures are redacted and mapped without secret leakage', async () => {
  const provider = { status: async () => ({ configured: true, accessKeyHint: null, provider: 'electron-safe-storage' }), loadForReadOnlyUse: async () => ({ accessKey: 'ACCESS-1234567890', secretKey: 'SECRET-0987654321' }), saveForReadOnlyUse: async () => {}, deleteCredentials: async () => {} };
  const adapter = { getAccounts: async () => [], getOrders: async () => [], getOpenOrders: async () => [], getOrder: async () => { throw new Error('unused'); }, getOrderChance: async () => { throw new Error('unused'); }, captureSnapshot: async () => { throw new UpbitApiError(401, 'invalid_authorization', 'access_key=ACCESS-1234567890 secret_key=SECRET-0987654321', false); } };
  const service = new UpbitReadOnlyService(provider, () => adapter);
  const result = await service.captureSnapshot();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_CREDENTIALS');
  assert.doesNotMatch(JSON.stringify(result), /ACCESS-1234567890|SECRET-0987654321/);
});

test('reconciliation remains read-only and distinguishes UNKNOWN MATCH and DIFF', () => {
  const first = reconcileReadOnlySnapshots(null, snapshot);
  assert.equal(first.status, 'UNKNOWN');
  const match = reconcileReadOnlySnapshots(snapshot, snapshot);
  assert.equal(match.status, 'MATCH');
  const changed = { ...snapshot, observedAt: '2026-08-07T00:01:00.000Z', accounts: [{ ...snapshot.accounts[0], balance: '999' }] };
  const diff = reconcileReadOnlySnapshots(snapshot, changed);
  assert.equal(diff.status, 'DIFF');
  assert.deepEqual(diff.changedCurrencies, ['KRW']);
});

test('integration policy, capability guard, layout protection, and evidence all pass', () => {
  const result = validate();
  assert.equal(result.pass, true, result.failures.join('\n'));
  const evidence = buildEvidence(result, 'test-sha');
  assert.equal(evidence.result, 'PASS');
  assert.equal(evidence.secretMaterialIncluded, false);
  assert.equal(evidence.executionTransportConnected, false);
  assert.equal(evidence.credentialExecutionUseAllowed, false);
  const layout = resolveUserDataLayout({ userDataPath: path.join('C:', 'Users', 'tester', 'NUSA'), packaged: true });
  assert.match(layout.readOnlyBrokerCredentialFile, /credentials[\\/]upbit-read-only\.enc$/);
  assert.ok(protectedPaths(layout).includes(layout.readOnlyBrokerCredentialFile));
});
