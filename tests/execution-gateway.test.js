const test = require("node:test");
const assert = require("node:assert/strict");
const contracts = require("../dist/packages/contracts/src/index.js");
const execution = require("../dist/apps/execution/src/index.js");

const { LedgerSide } = contracts;
const {
  InMemoryIdempotencyStore,
  InMemoryOrderExecutionRepository,
  OrderAdmissionDecisionType,
  OrderSubmissionStatus,
  ScriptedSyntheticOrderProvider,
  executeAdmittedOrder
} = execution;

function intent(overrides = {}) {
  return {
    intentId: "intent-1",
    idempotencyKey: "key-1",
    environment: "SYNTHETIC",
    accountId: "account-1",
    strategyId: "strategy-1",
    symbol: "BTC-USDT",
    side: LedgerSide.BUY,
    orderType: "MARKET",
    baseQtyRaw: 1n,
    quoteQtyRaw: 10n,
    createdAtMs: 1000,
    ...overrides
  };
}

function gatewayContext(overrides = {}) {
  return {
    nowMs: 1000,
    createExecutionId: () => "execution-1",
    admission: {
      nowMs: 1000,
      authorization: {
        environment: "SYNTHETIC",
        accountIds: ["account-1"],
        strategyIds: ["strategy-1"],
        symbols: ["BTC-USDT"],
        orderTypes: ["MARKET"],
        expiresAtMs: 2000
      },
      riskContext: { position: { baseQtyRaw: 0n, realizedPnlRaw: 0n } },
      riskPolicy: { maxOrderQuoteRaw: 100n, maxPositionBaseRaw: 2n }
    },
    ...overrides
  };
}

function dependencies(outcomes) {
  return {
    idempotency: new InMemoryIdempotencyStore(),
    executions: new InMemoryOrderExecutionRepository(),
    provider: new ScriptedSyntheticOrderProvider(outcomes)
  };
}

test("accepted synthetic order is recorded once", () => {
  const deps = dependencies([{ type: "ACCEPT", providerOrderId: "provider-1" }]);
  const first = executeAdmittedOrder(intent(), gatewayContext(), deps.idempotency, deps.executions, deps.provider);
  const second = executeAdmittedOrder(intent(), gatewayContext(), deps.idempotency, deps.executions, deps.provider);

  assert.equal(first.admission.type, OrderAdmissionDecisionType.ALLOW);
  assert.equal(first.execution.status, OrderSubmissionStatus.ACCEPTED);
  assert.equal(first.execution.providerOrderId, "provider-1");
  assert.equal(second.admission.type, OrderAdmissionDecisionType.DUPLICATE);
  assert.equal(second.execution.status, OrderSubmissionStatus.ACCEPTED);
  assert.equal(deps.provider.submitCount, 1);
});

test("provider rejection is terminal and never automatically resubmitted", () => {
  const deps = dependencies([{ type: "REJECT", reason: "synthetic rejection" }]);
  const first = executeAdmittedOrder(intent(), gatewayContext(), deps.idempotency, deps.executions, deps.provider);
  const second = executeAdmittedOrder(intent(), gatewayContext(), deps.idempotency, deps.executions, deps.provider);

  assert.equal(first.execution.status, OrderSubmissionStatus.REJECTED);
  assert.equal(first.execution.reason, "synthetic rejection");
  assert.equal(second.execution.status, OrderSubmissionStatus.REJECTED);
  assert.equal(deps.provider.submitCount, 1);
});

test("provider exception becomes submission unknown without automatic retry", () => {
  const deps = dependencies([
    { type: "THROW", reason: "response lost after submit" },
    { type: "ACCEPT", providerOrderId: "must-not-run" }
  ]);
  const first = executeAdmittedOrder(intent(), gatewayContext(), deps.idempotency, deps.executions, deps.provider);
  const second = executeAdmittedOrder(intent(), gatewayContext(), deps.idempotency, deps.executions, deps.provider);

  assert.equal(first.execution.status, OrderSubmissionStatus.SUBMISSION_UNKNOWN);
  assert.match(first.execution.reason, /response lost/);
  assert.equal(second.admission.type, OrderAdmissionDecisionType.DUPLICATE);
  assert.equal(second.execution.status, OrderSubmissionStatus.SUBMISSION_UNKNOWN);
  assert.equal(deps.provider.submitCount, 1);
});

test("blocked admission never reaches provider", () => {
  const deps = dependencies([{ type: "ACCEPT", providerOrderId: "must-not-run" }]);
  const result = executeAdmittedOrder(
    intent({ accountId: "unauthorized" }),
    gatewayContext(),
    deps.idempotency,
    deps.executions,
    deps.provider
  );

  assert.equal(result.admission.type, OrderAdmissionDecisionType.BLOCK);
  assert.equal(result.execution, undefined);
  assert.equal(deps.provider.submitCount, 0);
});

test("production execution is hard blocked in reconstructed baseline", () => {
  const deps = dependencies([{ type: "ACCEPT", providerOrderId: "must-not-run" }]);
  assert.throws(
    () => executeAdmittedOrder(
      intent({ environment: "PRODUCTION" }),
      gatewayContext(),
      deps.idempotency,
      deps.executions,
      deps.provider
    ),
    /production execution is not available/
  );
  assert.equal(deps.provider.submitCount, 0);
});

test("provider environment must match intent environment", () => {
  const deps = dependencies([{ type: "ACCEPT", providerOrderId: "must-not-run" }]);
  assert.throws(
    () => executeAdmittedOrder(
      intent({ environment: "TESTNET" }),
      gatewayContext({
        admission: {
          ...gatewayContext().admission,
          authorization: {
            ...gatewayContext().admission.authorization,
            environment: "TESTNET"
          }
        }
      }),
      deps.idempotency,
      deps.executions,
      deps.provider
    ),
    /provider environment does not match/
  );
  assert.equal(deps.provider.submitCount, 0);
});
