#!/usr/bin/env node
"use strict";

// OFFLINE SYNTHETIC RESEARCH ONLY. No network, market-data, account, order or runtime imports.
// V1/F2b compares hold lengths at equal per-day IC and measures e-process variants; it adopts none.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const PRIMARY_OUTPUT_PATH = path.resolve(__dirname, "../../docs/research-data/alpha-lab-f2b-evalue-power-2026-11-28.json");

const BASE_LAMBDAS = Object.freeze([0.02, 0.05, 0.1, 0.2, 0.35, 0.5]);
const VARIANTS = Object.freeze([
  Object.freeze({ id: "baseline-fixed-mixture-clip4", kind: "mixture", clipMultiplier: 4, lambdas: BASE_LAMBDAS }),
  Object.freeze({ id: "wider-fixed-mixture-clip4", kind: "mixture", clipMultiplier: 4, lambdas: Object.freeze([0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 0.9, 0.98]) }),
  Object.freeze({ id: "predictable-adaptive-bet-clip4", kind: "adaptive", clipMultiplier: 4, lambdas: Object.freeze([]), maximumLambda: 0.99 }),
  Object.freeze({ id: "baseline-fixed-mixture-clip8", kind: "mixture", clipMultiplier: 8, lambdas: BASE_LAMBDAS }),
]);

const PRIMARY_CONFIG = Object.freeze({
  schemaVersion: 1,
  seed: 20261128,
  replicationsPerScenario: 1000,
  holdsDays: Object.freeze([1, 5, 20]),
  dailyIcValues: Object.freeze([0, 0.02, 0.04, 0.08]),
  nullInnovationShapes: Object.freeze(["symmetric-t4", "right-skewed-zero-mean"]),
  nullAlphaForComparisonOnly: 0.0125,
  markets: 56,
  days: 365,
  burnInDays: 20,
  marketDailyVolatility: 0.03,
  idiosyncraticDailyVolatility: 0.035,
  perUnitOneWayTurnoverCost: 0.0015,
  topMarkets: Math.round(56 / 3),
  variants: VARIANTS.map((variant) => ({ ...variant, lambdas: [...variant.lambdas] })),
  model: "one-factor t4 common market return; independent standardized idiosyncratic innovations; score predicts normalized block idiosyncratic return",
  nullInterpretation: "Null rows have no predictive score (raw expected excess zero) and no turnover cost; for right-skewed rows this differs from the clipped conditional-mean null tested by the e-process.",
  alternativeCostConvention: "Existing F2 convention: subtract 0.0015 times daily one-way weight turnover; no execution or maker-fill claim.",
});

function fail(code) {
  throw new Error(code);
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random) {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

function t4UnitVariance(random) {
  let squared = 0;
  for (let i = 0; i < 4; i += 1) {
    const sample = normal(random);
    squared += sample * sample;
  }
  return normal(random) / Math.sqrt(squared / 4) * Math.SQRT1_2;
}

const SKEW_LOG_SIGMA = 1.25;
const SKEW_LOG_MEAN = Math.exp(SKEW_LOG_SIGMA * SKEW_LOG_SIGMA / 2);
const SKEW_LOG_SD = Math.sqrt(Math.expm1(SKEW_LOG_SIGMA * SKEW_LOG_SIGMA) * Math.exp(SKEW_LOG_SIGMA * SKEW_LOG_SIGMA));

function rightSkewedZeroMeanUnitVariance(random) {
  return (Math.exp(SKEW_LOG_SIGMA * normal(random)) - SKEW_LOG_MEAN) / SKEW_LOG_SD;
}

function innovation(random, shape) {
  if (shape === "symmetric-t4") return t4UnitVariance(random);
  if (shape === "right-skewed-zero-mean") return rightSkewedZeroMeanUnitVariance(random);
  fail("INNOVATION_SHAPE_INVALID:" + shape);
}

function blockCorrelationForDailyIc(dailyIc, holdDays) {
  if (!Number.isFinite(dailyIc) || dailyIc < 0 || dailyIc >= 1 || !Number.isSafeInteger(holdDays) || holdDays < 1) {
    fail("IC_OR_HOLD_INVALID");
  }
  const blockCorrelation = dailyIc * Math.sqrt(holdDays);
  if (blockCorrelation >= 1) fail("BLOCK_CORRELATION_INVALID");
  return blockCorrelation;
}

function rankTopWeights(scores, topCount) {
  const order = Array.from({ length: scores.length }, (_, index) => index)
    .sort((left, right) => scores[right] - scores[left] || left - right);
  const weights = new Float64Array(scores.length);
  for (let index = 0; index < topCount; index += 1) weights[order[index]] = 1 / topCount;
  return weights;
}

function generateExcessPath({ random, dailyIc, holdDays, innovationShape, costOn, config = PRIMARY_CONFIG }) {
  const { markets, days, idiosyncraticDailyVolatility, marketDailyVolatility, perUnitOneWayTurnoverCost, topMarkets } = config;
  const rho = blockCorrelationForDailyIc(dailyIc, holdDays);
  const excess = new Float64Array(days);
  const grossExcess = new Float64Array(days);
  const turnover = new Float64Array(days);
  let previousWeights = new Float64Array(markets);

  for (let blockStart = 0; blockStart < days; blockStart += holdDays) {
    const blockLength = Math.min(holdDays, days - blockStart);
    const blockReturns = [];
    const blockTarget = new Float64Array(markets);
    // Generate the complete forecast horizon even for a final partial block.
    // This keeps the declared per-day IC calibration (rho / sqrt(H)) constant.
    for (let day = 0; day < holdDays; day += 1) {
      const row = new Float64Array(markets);
      for (let market = 0; market < markets; market += 1) {
        row[market] = innovation(random, innovationShape);
        blockTarget[market] += row[market];
      }
      blockReturns.push(row);
    }

    const scores = new Float64Array(markets);
    const independentScale = Math.sqrt(1 - rho * rho);
    for (let market = 0; market < markets; market += 1) {
      const normalizedBlockReturn = blockTarget[market] / Math.sqrt(holdDays);
      scores[market] = rho * normalizedBlockReturn + independentScale * normal(random);
    }
    const weights = rankTopWeights(scores, topMarkets);

    for (let offset = 0; offset < blockLength; offset += 1) {
      const day = blockStart + offset;
      const common = marketDailyVolatility * t4UnitVariance(random);
      const row = blockReturns[offset];
      let heldReturn = 0;
      let basketReturn = 0;
      let dayTurnover = 0;
      for (let market = 0; market < markets; market += 1) {
        const marketReturn = common + idiosyncraticDailyVolatility * row[market];
        heldReturn += weights[market] * marketReturn;
        basketReturn += marketReturn / markets;
        dayTurnover += Math.abs(weights[market] - previousWeights[market]);
      }
      const gross = heldReturn - basketReturn;
      turnover[day] = dayTurnover;
      grossExcess[day] = gross;
      excess[day] = gross - (costOn ? perUnitOneWayTurnoverCost * dayTurnover : 0);
      previousWeights = weights;
    }
  }

  return { excess, grossExcess, turnover };
}

function sampleVarianceState() {
  return { count: 0, mean: 0, m2: 0 };
}

function updateVariance(state, value) {
  state.count += 1;
  const delta = value - state.mean;
  state.mean += delta / state.count;
  state.m2 += delta * (value - state.mean);
}

function sampleStandardDeviation(state) {
  if (state.count < 2) return 0;
  return Math.sqrt(Math.max(0, state.m2 / (state.count - 1)));
}

function adaptiveLambdaFromPast(pastY, maximumLambda = 0.99) {
  if (!Array.isArray(pastY) || !Number.isFinite(maximumLambda) || maximumLambda <= 0 || maximumLambda >= 1) fail("ADAPTIVE_INPUT_INVALID");
  if (pastY.some((value) => !Number.isFinite(value) || value < -1 || value > 1)) fail("ADAPTIVE_HISTORY_INVALID");
  if (pastY.length === 0) return 0;
  const mean = pastY.reduce((sum, value) => sum + value, 0) / pastY.length;
  if (mean <= 0) return 0;
  const secondMoment = pastY.reduce((sum, value) => sum + value * value, 0) / pastY.length;
  if (secondMoment <= 0) return 0;
  return Math.min(maximumLambda, mean / secondMoment);
}

function clip(value) {
  return Math.max(-1, Math.min(1, value));
}

function evaluateEProcess(excess, variant, config = PRIMARY_CONFIG) {
  const wealth = variant.kind === "mixture" ? variant.lambdas.map(() => 1) : [1];
  const historyVariance = sampleVarianceState();
  const pastY = [];
  let passDay = null;
  let passEValue = null;
  let clippedSum = 0;
  let clippedCount = 0;
  const threshold = 1 / config.nullAlphaForComparisonOnly;

  for (let day = 0; day < excess.length; day += 1) {
    const previousSd = sampleStandardDeviation(historyVariance);
    const denominator = variant.clipMultiplier * previousSd;
    const y = denominator > 0 ? clip(excess[day] / denominator) : 0;
    if (day >= config.burnInDays) {
      clippedSum += y;
      clippedCount += 1;
      // Record the first crossing, but evaluate the full path so the clipped-
      // mean diagnostic is not truncated at the stopping time.
      if (passDay === null) {
        if (variant.kind === "mixture") {
          for (let index = 0; index < variant.lambdas.length; index += 1) {
            const factor = 1 + variant.lambdas[index] * y;
            if (!Number.isFinite(factor) || factor < 0) fail("EPROCESS_FACTOR_INVALID");
            wealth[index] *= factor;
          }
          const eValue = wealth.reduce((sum, value) => sum + value, 0) / wealth.length;
          if (eValue >= threshold) {
            passDay = day + 1;
            passEValue = eValue;
          }
        } else if (variant.kind === "adaptive") {
          // The wager uses only normalized observations strictly before the current one.
          const lambda = adaptiveLambdaFromPast(pastY, variant.maximumLambda);
          const factor = 1 + lambda * y;
          if (!Number.isFinite(factor) || factor < 0) fail("EPROCESS_FACTOR_INVALID");
          wealth[0] *= factor;
          if (wealth[0] >= threshold) {
            passDay = day + 1;
            passEValue = wealth[0];
          }
        } else {
          fail("EPROCESS_VARIANT_INVALID:" + variant.kind);
        }
      }
    }
    pastY.push(y);
    updateVariance(historyVariance, excess[day]);
  }

  const meanClippedYAfterBurnIn = clippedCount ? clippedSum / clippedCount : null;
  return { passDay, passEValue, meanClippedYAfterBurnIn };
}

function wilsonInterval(successes, trials) {
  const z = 1.959963984540054;
  const proportion = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (proportion + (z * z) / (2 * trials)) / denominator;
  const halfWidth = (z * Math.sqrt((proportion * (1 - proportion)) / trials + (z * z) / (4 * trials * trials))) / denominator;
  return { lower: Math.max(0, center - halfWidth), upper: Math.min(1, center + halfWidth) };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function pathStatistics(pathData) {
  const n = pathData.excess.length;
  const meanExcess = pathData.excess.reduce((sum, value) => sum + value, 0) / n;
  const meanGross = pathData.grossExcess.reduce((sum, value) => sum + value, 0) / n;
  const sumSquaredDeviations = pathData.excess.reduce((sum, value) => sum + (value - meanExcess) ** 2, 0);
  const sdExcess = Math.sqrt(sumSquaredDeviations / Math.max(1, n - 1));
  const meanTurnover = pathData.turnover.reduce((sum, value) => sum + value, 0) / n;
  const sharpeScale = Math.sqrt(365);
  return {
    meanDailyNetExcess: meanExcess,
    meanDailyGrossExcess: meanGross,
    meanNetSharpe: sdExcess > 0 ? (meanExcess / sdExcess) * sharpeScale : null,
    meanGrossSharpeUsingNetSd: sdExcess > 0 ? (meanGross / sdExcess) * sharpeScale : null,
    meanDailyTurnover: meanTurnover,
  };
}

function scenarioSeed(seed, holdDays, dailyIc, shape) {
  const shapeOffset = shape === "right-skewed-zero-mean" ? 0x51f15e : 0x13579b;
  return (seed + holdDays * 100003 + Math.round(dailyIc * 100000) * 37 + shapeOffset) >>> 0;
}

function runScenario({ holdDays, dailyIc, innovationShape, config = PRIMARY_CONFIG }) {
  const isNull = dailyIc === 0;
  const costOn = !isNull;
  const random = mulberry32(scenarioSeed(config.seed, holdDays, dailyIc, innovationShape));
  const rows = VARIANTS.map((variant) => ({
    variantId: variant.id,
    passes: 0,
    pass90: 0,
    pass180: 0,
    passDays: [],
    rawMeanTotal: 0,
    clippedMeanTotal: 0,
    netSharpeTotal: 0,
    grossSharpeTotal: 0,
    turnoverTotal: 0,
  }));

  for (let replication = 0; replication < config.replicationsPerScenario; replication += 1) {
    const pathData = generateExcessPath({ random, dailyIc, holdDays, innovationShape, costOn, config });
    const stats = pathStatistics(pathData);
    for (let variantIndex = 0; variantIndex < VARIANTS.length; variantIndex += 1) {
      const variant = VARIANTS[variantIndex];
      const result = evaluateEProcess(pathData.excess, variant, config);
      const row = rows[variantIndex];
      if (result.passDay !== null) {
        row.passes += 1;
        row.passDays.push(result.passDay);
        if (result.passDay <= 90) row.pass90 += 1;
        if (result.passDay <= 180) row.pass180 += 1;
      }
      row.rawMeanTotal += stats.meanDailyNetExcess;
      row.clippedMeanTotal += result.meanClippedYAfterBurnIn || 0;
      row.netSharpeTotal += stats.meanNetSharpe || 0;
      row.grossSharpeTotal += stats.meanGrossSharpeUsingNetSd || 0;
      row.turnoverTotal += stats.meanDailyTurnover;
    }
  }

  return {
    holdDays,
    dailyIc,
    innovationShape,
    costOn,
    replications: config.replicationsPerScenario,
    rows: rows.map((row) => ({
      variantId: row.variantId,
      meanRawDailyNetExcess: row.rawMeanTotal / config.replicationsPerScenario,
      meanClippedNormalizedExcessAfterBurnIn: row.clippedMeanTotal / config.replicationsPerScenario,
      meanNetSharpe: row.netSharpeTotal / config.replicationsPerScenario,
      meanGrossSharpeUsingNetSd: row.grossSharpeTotal / config.replicationsPerScenario,
      meanDailyTurnover: row.turnoverTotal / config.replicationsPerScenario,
      passByDay90: row.pass90 / config.replicationsPerScenario,
      passByDay180: row.pass180 / config.replicationsPerScenario,
      passByDay365: row.passes / config.replicationsPerScenario,
      passByDay365Wilson95: wilsonInterval(row.passes, config.replicationsPerScenario),
      medianPassDayAmongPasses: median(row.passDays),
    })),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function runPrimary(config = PRIMARY_CONFIG) {
  const currentScriptHash = sha256(fs.readFileSync(__filename));
  const canonicalConfig = JSON.stringify(canonicalJson(config));
  const configHash = sha256(Buffer.from(canonicalConfig, "utf8"));
  const scenarios = [];
  for (const holdDays of config.holdsDays) {
    for (const dailyIc of config.dailyIcValues) {
      const shapes = dailyIc === 0 ? config.nullInnovationShapes : ["symmetric-t4"];
      for (const innovationShape of shapes) {
        scenarios.push(runScenario({ holdDays, dailyIc, innovationShape, config }));
      }
    }
  }
  return {
    schemaVersion: 1,
    experimentId: "ALPHA_LAB_F2B_SYNTHETIC_EVALUE_POWER_2026-11-28",
    evidenceClass: "SYNTHETIC_ONLY_NOT_MARKET_EVIDENCE",
    analysisScriptSha256: currentScriptHash,
    configSha256: configHash,
    configuration: canonicalJson(config),
    scenarios,
    interpretationLimits: [
      "This is a synthetic Monte Carlo measurement, not a real-market result, strategy edge, hold recommendation, or power guarantee.",
      "The right-skewed null has zero raw mean; a positive clipped mean is outside the clipped conditional-mean null and is shown to diagnose that distinction, not as an e-process validity failure.",
      "The adaptive bet is predictable from past clipped observations and is bounded below 1; its validity still depends on the stated clipped conditional-mean null.",
      "The proposed alpha is copied only for F2 comparison and is not adopted as a program alpha or registration budget.",
      "No real data, order book, execution, fill model, promotion gate, or PAPER/production path is tested.",
    ],
  };
}

function selfTest() {
  let assertions = 0;
  for (const holdDays of [1, 5, 20]) {
    const rho = blockCorrelationForDailyIc(0.04, holdDays);
    if (Math.abs((rho / Math.sqrt(holdDays)) - 0.04) > 1e-12) fail("SELF_TEST_DAILY_IC_NOT_EQUAL");
    assertions += 1;
  }
  const past = [-0.2, -0.1];
  const wagerFromPastOnly = adaptiveLambdaFromPast(past, 0.99);
  const wagerAfterNewObservation = adaptiveLambdaFromPast([...past, 0.99], 0.99);
  if (wagerFromPastOnly === wagerAfterNewObservation || wagerFromPastOnly < 0 || wagerFromPastOnly >= 1) fail("SELF_TEST_ADAPTIVE_WAGER_INVALID");
  assertions += 1;
  for (const lambda of [...BASE_LAMBDAS, 0.98, wagerFromPastOnly]) {
    for (const y of [-1, -0.5, 0, 0.5, 1]) {
      if (1 + lambda * y < 0) fail("SELF_TEST_NEGATIVE_EPROCESS_FACTOR");
      assertions += 1;
    }
  }
  const config = { ...PRIMARY_CONFIG, markets: 12, days: 20, burnInDays: 4, topMarkets: 4 };
  const makePath = () => generateExcessPath({ random: mulberry32(12345), dailyIc: 0.04, holdDays: 5, innovationShape: "symmetric-t4", costOn: true, config });
  const pathOne = makePath();
  const pathTwo = makePath();
  if (Buffer.from(pathOne.excess.buffer).compare(Buffer.from(pathTwo.excess.buffer)) !== 0) fail("SELF_TEST_NONDETERMINISTIC_PATH");
  assertions += 1;
  const result = evaluateEProcess(pathOne.excess, VARIANTS[2], config);
  if (result.passDay !== null && (result.passDay < config.burnInDays + 1 || !Number.isFinite(result.passEValue))) fail("SELF_TEST_PASS_DAY_INVALID");
  assertions += 1;
  return { pass: true, assertions, networkOrMarketData: false };
}

function writePrimary() {
  const resolved = PRIMARY_OUTPUT_PATH;
  if (fs.existsSync(resolved)) fail("PRIMARY_ARTIFACT_ALREADY_EXISTS");
  const artifact = runPrimary();
  const text = JSON.stringify(artifact, null, 2) + "\n";
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const fd = fs.openSync(resolved, "wx", 0o600);
  try {
    fs.writeSync(fd, text, null, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { outputPath: resolved, bytes: Buffer.byteLength(text), artifactSha256: sha256(Buffer.from(text, "utf8")), analysisScriptSha256: artifact.analysisScriptSha256 };
}

function main(argv) {
  if (argv[0] === "--self-test") {
    process.stdout.write(JSON.stringify(selfTest(), null, 2) + "\n");
    return;
  }
  if (argv[0] === "--primary" && argv.length === 1) {
    const receipt = writePrimary();
    process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
    return;
  }
  if (argv.length === 0 || argv[0] === "--help") {
    process.stdout.write("Offline synthetic F2b e-process power study\n  --self-test\n  --primary  (creates the fixed artifact once; refuses overwrite)\n");
    return;
  }
  fail("CLI_ARGUMENTS_INVALID");
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  }
}

module.exports = {
  PRIMARY_CONFIG,
  PRIMARY_OUTPUT_PATH,
  VARIANTS,
  adaptiveLambdaFromPast,
  blockCorrelationForDailyIc,
  evaluateEProcess,
  generateExcessPath,
  runPrimary,
  runScenario,
  selfTest,
  wilsonInterval,
};
