"use strict";
/**
 * Independent verification of a cross-market validation result (WO-0030).
 *
 * Does NOT call the runner's cell-plan builder, group summarizer, concentration
 * analyzer, or assessment function. Every check is re-derived here from the raw
 * request and the result's own recorded per-cell numbers, so a bug in the runner's
 * aggregation cannot be confirmed by its own aggregation.
 *
 * The single most important check is FAIRNESS PARITY: every cell must have been run
 * with identical strategy parameters, identical cost conditions, and identical risk
 * assumptions. A per-market parameter or a per-market cost would make the whole
 * comparison meaningless, so it is checked explicitly rather than assumed.
 */
const { canonicalHash } = require("./canonical-hash.js");

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

function verifyView(view, request, label, errors) {
  const cells = view.cells ?? [];

  // Cell completeness: one cell per declared dataset, no duplicates, none dropped.
  const expectedKeys = new Set(request.datasets.map((dataset) => `${dataset.symbol}|${dataset.periodLabel}`));
  const actualKeys = cells.map((cell) => `${cell.symbol}|${cell.periodLabel}`);
  if (actualKeys.length !== request.datasets.length) errors.push(`${label}: cell count ${actualKeys.length} does not match dataset count ${request.datasets.length}`);
  if (new Set(actualKeys).size !== actualKeys.length) errors.push(`${label}: duplicate market/period cell in the result`);
  for (const key of expectedKeys) if (!actualKeys.includes(key)) errors.push(`${label}: missing cell ${key}`);

  // Canonical ordering: symbol asc, then start time asc.
  for (let index = 1; index < cells.length; index += 1) {
    const previous = cells[index - 1];
    const current = cells[index];
    const order = previous.symbol.localeCompare(current.symbol) || (previous.startTime - current.startTime);
    if (order > 0) errors.push(`${label}: cells are not in canonical order at index ${index}`);
  }

  const evaluated = cells.filter((cell) => cell.status === "PASS");

  // A losing cell must never be missing: every non-blocked cell has to carry results
  // for all three cost conditions.
  for (const cell of cells) {
    if (cell.status === "BLOCKED") continue;
    for (const condition of ["BASE", "MODERATE", "SEVERE"]) {
      if (!cell.byCondition || cell.byCondition[condition] == null) errors.push(`${label}: cell ${cell.symbol}|${cell.periodLabel} is missing ${condition} results`);
    }
  }

  // Aggregate ratios recomputed from the cells themselves.
  if (view.aggregate) {
    const positiveRatio = evaluated.length ? evaluated.filter((cell) => cell.byCondition.BASE.totalReturn > 0).length / evaluated.length : 0;
    if (Math.abs(positiveRatio - view.aggregate.positiveCellRatio) > 1e-9) errors.push(`${label}: positiveCellRatio mismatch: recomputed ${positiveRatio}, result reports ${view.aggregate.positiveCellRatio}`);

    const bnhRatio = evaluated.length ? evaluated.filter((cell) => cell.beatsBuyAndHold).length / evaluated.length : 0;
    if (Math.abs(bnhRatio - view.aggregate.buyAndHoldOutperformRatio) > 1e-9) errors.push(`${label}: buyAndHoldOutperformRatio mismatch`);

    const recomputedMedian = median(evaluated.map((cell) => cell.byCondition.BASE.totalReturn));
    if (Math.abs(recomputedMedian - view.aggregate.medianCellReturn) > 1e-9) errors.push(`${label}: medianCellReturn mismatch`);

    if (evaluated.length !== view.aggregate.evaluatedCellCount) errors.push(`${label}: evaluatedCellCount mismatch`);
    if (cells.filter((cell) => cell.status === "BLOCKED").length !== view.aggregate.blockedCellCount) errors.push(`${label}: blockedCellCount mismatch`);
    if (cells.length !== view.aggregate.cellCount) errors.push(`${label}: cellCount mismatch`);
  }

  // Per-cell beats* flags recomputed rather than trusted.
  for (const cell of evaluated) {
    const base = cell.byCondition.BASE;
    if (cell.beatsCash !== base.totalReturn > 0) errors.push(`${label}: cell ${cell.symbol}|${cell.periodLabel} beatsCash flag disagrees with its own return`);
    if (cell.beatsBuyAndHold !== base.totalReturn > base.buyAndHoldReturn) errors.push(`${label}: cell ${cell.symbol}|${cell.periodLabel} beatsBuyAndHold flag disagrees with its own numbers`);
    if (cell.benchmarks.cashReturn !== 0) errors.push(`${label}: cash benchmark must be flat`);
  }

  // Market and period summaries recomputed independently.
  for (const [summaries, keyName] of [[view.marketSummaries ?? [], "symbol"], [view.periodSummaries ?? [], "periodLabel"]]) {
    for (const summary of summaries) {
      const groupCells = cells.filter((cell) => cell[keyName] === summary.key);
      const groupEvaluated = groupCells.filter((cell) => cell.status === "PASS");
      if (groupCells.length !== summary.cellCount) errors.push(`${label}: ${keyName} ${summary.key} cellCount mismatch`);
      const positives = groupEvaluated.filter((cell) => cell.byCondition.BASE.totalReturn > 0).length;
      if (positives !== summary.positiveCellCount) errors.push(`${label}: ${keyName} ${summary.key} positiveCellCount mismatch: recomputed ${positives}, result reports ${summary.positiveCellCount}`);
      const netProfit = groupEvaluated.reduce((sum, cell) => sum + cell.byCondition.BASE.netProfit, 0);
      if (Math.abs(netProfit - summary.totalNetProfit) > 1e-6) errors.push(`${label}: ${keyName} ${summary.key} totalNetProfit mismatch`);
    }
    const groupKeys = new Set(cells.map((cell) => cell[keyName]));
    if (summaries.length !== groupKeys.size) errors.push(`${label}: ${keyName} summary count ${summaries.length} does not match distinct ${keyName} count ${groupKeys.size}`);
  }

  // Assessment sanity, re-derived from the recomputed numbers rather than trusted.
  if (view.generalizationAssessment === "BROADLY_GENERALIZABLE") {
    const positiveRatio = evaluated.length ? evaluated.filter((cell) => cell.byCondition.BASE.totalReturn > 0).length / evaluated.length : 0;
    if (positiveRatio < 0.6) errors.push(`${label}: BROADLY_GENERALIZABLE requires a positive-cell ratio of at least 0.6, recomputed ${positiveRatio}`);
    const marketsWithNoWinner = (view.marketSummaries ?? []).filter((summary) => summary.evaluatedCellCount > 0 && summary.positiveCellCount === 0);
    if (marketsWithNoWinner.length > 0) errors.push(`${label}: BROADLY_GENERALIZABLE but market(s) ${marketsWithNoWinner.map((s) => s.key).join(",")} have no positive cell`);
  }
  if (view.generalizationAssessment === "BROADLY_GENERALIZABLE" && evaluated.length < cells.length / 2) {
    errors.push(`${label}: BROADLY_GENERALIZABLE with fewer than half the cells evaluated`);
  }

  // Concentration recomputed on absolute net profit.
  if (view.concentration?.byMarket) {
    const totals = new Map();
    for (const cell of evaluated) totals.set(cell.symbol, (totals.get(cell.symbol) ?? 0) + cell.byCondition.BASE.netProfit);
    const magnitudes = [...totals.values()].map(Math.abs);
    const total = magnitudes.reduce((sum, value) => sum + value, 0);
    const top = magnitudes.length ? Math.max(...magnitudes) : 0;
    const ratio = total > 0 ? top / total : 0;
    if (Math.abs(ratio - view.concentration.byMarket.topContributionRatio) > 1e-9) errors.push(`${label}: byMarket topContributionRatio mismatch: recomputed ${ratio}, result reports ${view.concentration.byMarket.topContributionRatio}`);
  }
}

function verifyCrossMarketResult(request, result) {
  const errors = [];
  if (!result || result.status === undefined) { errors.push("result is missing a status field"); return { status: "FAIL", errors }; }
  if (result.status === "FAIL" && result.fullAvailablePeriod == null) {
    return { status: "PASS", errors: [], note: "request-level validation failure; nothing further to verify" };
  }

  // FAIRNESS PARITY -- the check that makes the whole comparison meaningful.
  if (canonicalHash(result.strategy) !== canonicalHash(request.strategy)) errors.push("recorded strategy does not match the requested strategy");
  if (canonicalHash(result.costConditions) !== canonicalHash(request.costConditions)) errors.push("recorded cost conditions do not match the request");
  if (canonicalHash(result.execution) !== canonicalHash(request.execution)) errors.push("recorded execution assumptions do not match the request");

  const byName = Object.fromEntries((result.costConditions ?? []).map((c) => [c.name, c]));
  if (byName.BASE && byName.MODERATE && (byName.MODERATE.feeRate < byName.BASE.feeRate || byName.MODERATE.slippageBps < byName.BASE.slippageBps)) errors.push("recorded costConditions.MODERATE is less stressful than BASE");
  if (byName.MODERATE && byName.SEVERE && (byName.SEVERE.feeRate < byName.MODERATE.feeRate || byName.SEVERE.slippageBps < byName.MODERATE.slippageBps)) errors.push("recorded costConditions.SEVERE is less stressful than MODERATE");

  // One timeframe across every dataset, re-derived from the raw candles.
  const intervals = new Set(request.datasets.map((dataset) => dataset.candles[0].interval));
  if (intervals.size > 1) errors.push(`datasets span multiple timeframes (${[...intervals].join(", ")}), which is not comparable`);

  // Dataset content hashes must match what the result claims.
  for (const declared of result.datasets ?? []) {
    const source = request.datasets.find((dataset) => dataset.datasetId === declared.datasetId);
    if (!source) { errors.push(`result declares dataset ${declared.datasetId} which is not in the request`); continue; }
    if (declared.candleCount !== source.candles.length) errors.push(`dataset ${declared.datasetId}: candleCount mismatch`);
    if (declared.symbol !== source.symbol) errors.push(`dataset ${declared.datasetId}: symbol mismatch`);
  }
  if ((result.datasets ?? []).length !== request.datasets.length) errors.push("declared dataset count does not match the request");

  verifyView(result.fullAvailablePeriod, request, "fullAvailablePeriod", errors);
  verifyView(result.commonPeriod, request, "commonPeriod", errors);

  // The two views must stay separate: a common-period cell can never cover more
  // candles than its full-period counterpart.
  for (const commonCell of result.commonPeriod?.cells ?? []) {
    if (commonCell.status === "BLOCKED") continue;
    const fullCell = (result.fullAvailablePeriod?.cells ?? []).find((cell) => cell.symbol === commonCell.symbol && cell.periodLabel === commonCell.periodLabel);
    if (fullCell && fullCell.status !== "BLOCKED" && commonCell.evaluatedCandleCount > fullCell.evaluatedCandleCount) {
      errors.push(`common-period cell ${commonCell.symbol}|${commonCell.periodLabel} covers more candles than its full-period counterpart`);
    }
  }

  // Survivorship / selection bias must be disclosed, not omitted.
  if (result.selectionBiasDisclosure?.survivorshipBiasPresent !== true) errors.push("survivorship bias must be disclosed as present when delisted markets are absent");
  if (result.selectionBiasDisclosure?.marketsAreResearcherSelected !== true) errors.push("researcher market selection must be disclosed");

  if (result.hashes) {
    if (canonicalHash(request) !== result.hashes.requestSha256) errors.push("requestSha256 mismatch");
    if (canonicalHash(request.strategy) !== result.hashes.strategySha256) errors.push("strategySha256 mismatch");
    if (canonicalHash(result.datasets) !== result.hashes.datasetListSha256) errors.push("datasetListSha256 mismatch");
    if (canonicalHash(result.fullAvailablePeriod.marketSummaries) !== result.hashes.marketSummarySha256) errors.push("marketSummarySha256 mismatch (market summaries may have been altered)");
    if (canonicalHash(result.fullAvailablePeriod.periodSummaries) !== result.hashes.periodSummarySha256) errors.push("periodSummarySha256 mismatch (period summaries may have been altered)");
    if (canonicalHash(result.fullAvailablePeriod.aggregate) !== result.hashes.aggregateResultSha256) errors.push("aggregateResultSha256 mismatch (aggregate may have been altered)");
  } else {
    errors.push("result.hashes is missing");
  }

  return { status: errors.length === 0 ? "PASS" : "FAIL", errors };
}

module.exports = { verifyCrossMarketResult };
