import { describe, expect, it } from "vitest";
import { canonicalAuditDedupeKey, isRetryableAuditExecutionError } from "./auditExecutionIdentity";

const base = {
  repository: "cinamoncandy/NUSA",
  prNumber: 1814,
  headSha: "a8d7458b1000026cd29fb7c63631fc4af0a0d59f",
  baseSha: "c8095fe38d2ea097fbe167819ccf19f4260a7271",
  workflowRunId: 34541092478,
} as const;

describe("canonicalAuditDedupeKey", () => {
  it("collapses the historical #1878 duplicate Audit pair to one immutable identity", () => {
    const firstRun = { ...base, auditExecutionRunId: 34541568889, callerDedupeKey: "audit:34541568889" };
    const secondRun = { ...base, auditExecutionRunId: 34541579411, callerDedupeKey: "audit:34541579411" };

    expect(canonicalAuditDedupeKey(firstRun)).toBe(canonicalAuditDedupeKey(secondRun));
  });

  it("treats a new exact head or canonical CI run as a new identity", () => {
    expect(canonicalAuditDedupeKey({ ...base, workflowRunId: base.workflowRunId + 1 })).not.toBe(canonicalAuditDedupeKey(base));
    expect(canonicalAuditDedupeKey({ ...base, headSha: "b".repeat(40) })).not.toBe(canonicalAuditDedupeKey(base));
  });

  it("binds base SHA as a stronger stale-base boundary", () => {
    expect(canonicalAuditDedupeKey({ ...base, baseSha: "d".repeat(40) })).not.toBe(canonicalAuditDedupeKey(base));
  });
});

describe("isRetryableAuditExecutionError", () => {
  it("allows only transient transport/service failures to reopen the lease", () => {
    expect(isRetryableAuditExecutionError(new Error("HTTP 503 upstream unavailable"))).toBe(true);
    expect(isRetryableAuditExecutionError(new Error("network timeout"))).toBe(true);
    expect(isRetryableAuditExecutionError(new Error("AUDIT_VERDICT_JSON_INVALID"))).toBe(false);
    expect(isRetryableAuditExecutionError(new Error("AUDIT_PR_HEAD_MISMATCH"))).toBe(false);
  });
});
