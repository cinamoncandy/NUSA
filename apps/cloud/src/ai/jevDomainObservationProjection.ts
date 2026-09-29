import {
  createJevDomainObservation,
  type JevDomainObservation,
} from "./jevDomainObservation";
import type { JevResearchAttentionShadowReceipt } from "./jevResearchAttentionShadow";
import type { JevWorkflowFailureReceipt } from "./jevWorkflowFailureDecision";

function providerId(model: string): string {
  if (model.startsWith("workers-ai:")) return "workers-ai";
  if (model === "deterministic-fallback") return "deterministic-fallback";
  return "jev-shadow";
}

/**
 * Adapts the established Autopilot receipt; this preserves its existing contract
 * while giving the rest of NUSA one bounded, replay-identifiable SHADOW shape.
 */
export function projectJevWorkflowFailureDomainObservation(
  receipt: JevWorkflowFailureReceipt,
): JevDomainObservation {
  return createJevDomainObservation({
    taskType: "WORKFLOW_FAILURE_CLASSIFICATION",
    inputFingerprint: receipt.stateFingerprint,
    sourceIdentity: `github:workflow-run:${receipt.decisionId}`,
    sourceVersion: `main:${receipt.sourceMainSha}`,
    decision: {
      rootCause: receipt.rootCause,
      safeToAutofix: receipt.safeToAutofix,
      severity: receipt.severity,
      requiredModel: receipt.requiredModel,
      confidence: receipt.confidence,
    },
    requiredModel: receipt.requiredModel,
    reasonCode: receipt.reasonCode,
    confidence: receipt.confidence,
    providerId: providerId(receipt.model),
    modelIdentity: receipt.model,
    providerModelVersion: receipt.model,
    timeoutApplied: false,
    fallbackApplied: receipt.escalated,
    correlationId: receipt.decisionId,
    traceId: receipt.executionId,
    timestamp: receipt.timestamp,
  });
}

/**
 * Research attention has a fixed low-tier SHADOW policy. The policy label is
 * provenance only; it cannot route, promote, or alter AXIOM handoff behavior.
 */
export function projectJevResearchAttentionDomainObservation(
  receipt: JevResearchAttentionShadowReceipt,
): JevDomainObservation {
  return createJevDomainObservation({
    taskType: "RESEARCH_INTELLIGENCE_ATTENTION_SHADOW",
    inputFingerprint: receipt.inputHash,
    sourceIdentity: `research-intelligence:${receipt.sourceRecordId}`,
    sourceVersion: `content:${receipt.sourceContentFingerprint}`,
    decision: {
      decision: receipt.selectedDecision,
      confidence: receipt.confidence,
      reasonCode: receipt.reasonCode,
    },
    requiredModel: "LUNA",
    reasonCode: receipt.reasonCode,
    confidence: receipt.confidence,
    providerId: providerId(receipt.model),
    modelIdentity: receipt.model,
    providerModelVersion: receipt.model,
    timeoutApplied: false,
    fallbackApplied: receipt.fallbackApplied,
    correlationId: receipt.decisionId,
    traceId: receipt.sourceRecordId,
    timestamp: receipt.timestamp,
  });
}
