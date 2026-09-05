/** Calibration and provider-disagreement metrics for WO-AI-011. */
export interface BinaryPrediction { readonly predictionId: string; readonly predictedProbability: number; readonly realizedOutcome: 0 | 1; }
export type MetricResult = { readonly resolved: true; readonly value: number; readonly sampleSize: number } | { readonly resolved: false; readonly reason: "EMPTY_SET" | "INVALID_INPUT" | "DUPLICATE_PREDICTION_ID" };
function valid(predictions: readonly BinaryPrediction[]): boolean {
  if (predictions.length === 0) return false;
  const seen = new Set<string>();
  for (const p of predictions) {
    if (seen.has(p.predictionId)) return false;
    seen.add(p.predictionId);
    if (!Number.isFinite(p.predictedProbability) || p.predictedProbability < 0 || p.predictedProbability > 1) return false;
    if (p.realizedOutcome !== 0 && p.realizedOutcome !== 1) return false;
  }
  return true;
}
function invalidReason(predictions: readonly BinaryPrediction[]): "INVALID_INPUT" | "DUPLICATE_PREDICTION_ID" {
  const seen = new Set<string>();
  for (const p of predictions) { if (seen.has(p.predictionId)) return "DUPLICATE_PREDICTION_ID"; seen.add(p.predictionId); }
  return "INVALID_INPUT";
}
export function computeBrierScore(predictions: readonly BinaryPrediction[]): MetricResult {
  if (predictions.length === 0) return { resolved: false, reason: "EMPTY_SET" };
  if (!valid(predictions)) return { resolved: false, reason: invalidReason(predictions) };
  return { resolved: true, value: predictions.reduce((s,p)=>s+(p.predictedProbability-p.realizedOutcome)**2,0)/predictions.length, sampleSize: predictions.length };
}
export function computeExpectedCalibrationError(predictions: readonly BinaryPrediction[], binCount: number): MetricResult {
  if (predictions.length === 0) return { resolved: false, reason: "EMPTY_SET" };
  if (!Number.isSafeInteger(binCount) || binCount <= 0) return { resolved: false, reason: "INVALID_INPUT" };
  if (!valid(predictions)) return { resolved: false, reason: invalidReason(predictions) };
  const bins = Array.from({ length: binCount }, () => ({ sumProb: 0, sumOutcome: 0, count: 0 }));
  for (const p of predictions) { const i=Math.min(binCount-1,Math.floor(p.predictedProbability*binCount)); bins[i].sumProb+=p.predictedProbability; bins[i].sumOutcome+=p.realizedOutcome; bins[i].count+=1; }
  let value=0; for (const b of bins) if (b.count) value+=(b.count/predictions.length)*Math.abs(b.sumProb/b.count-b.sumOutcome/b.count);
  return { resolved: true, value, sampleSize: predictions.length };
}
export interface MultiProviderPrediction { readonly predictionId: string; readonly providerDecisions: readonly string[]; }
export function computeDisagreementRate(predictions: readonly MultiProviderPrediction[]): MetricResult {
  if (predictions.length === 0) return { resolved: false, reason: "EMPTY_SET" };
  const seen=new Set<string>(); for(const p of predictions){ if(seen.has(p.predictionId)) return {resolved:false,reason:"DUPLICATE_PREDICTION_ID"}; seen.add(p.predictionId); if(p.providerDecisions.length<2) return {resolved:false,reason:"INVALID_INPUT"}; }
  return { resolved: true, value: predictions.filter((p)=>new Set(p.providerDecisions).size>1).length/predictions.length, sampleSize: predictions.length };
}
