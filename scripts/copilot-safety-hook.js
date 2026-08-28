#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const DENY_REASON = "NUSA deterministic safety hook denied a tool call that could weaken repository or trading safety authority.";

function readInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __malformed: true, raw };
  }
}

function flatten(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function classify(input) {
  if (!input || input.__malformed) {
    return { deny: true, reason: "Malformed hook input; NUSA fails closed." };
  }

  const toolName = String(input.toolName ?? input.tool_name ?? "").toLowerCase();
  const args = input.toolArgs ?? input.tool_input ?? {};
  const text = `${toolName}\n${flatten(args)}`.toLowerCase();

  const destructiveGit = [
    /git\s+push\b[^\n]*--force(?:-with-lease)?\b/,
    /git\s+branch\b[^\n]*\s-[dD]\b/,
    /git\s+update-ref\b[^\n]*-d\b/,
    /git\s+reset\s+--hard\b/
  ];

  const authorityEscalation = [
    /productionmutationallowed\s*[:=]\s*(true|1|yes)\b/,
    /liveauthority\s*[:=]\s*(?!none\b)[a-z0-9_-]+/,
    /aiauthority\s*[:=]\s*(?!zero_authority\b)[a-z0-9_-]+/,
    /nusa_live\s*=\s*(true|1|yes)\b/,
    /live_trading\s*=\s*(true|1|yes)\b/,
    /broker_mutation\s*=\s*(true|1|yes|enabled)\b/
  ];

  const highRiskTransfer = [
    /\b(withdraw|withdrawal|transfer)\b[^\n]{0,80}\b(api|broker|exchange|wallet|funds?|asset)/,
    /\b(api|broker|exchange|wallet|funds?|asset)\b[^\n]{0,80}\b(withdraw|withdrawal|transfer)\b/
  ];

  for (const pattern of destructiveGit) {
    if (pattern.test(text)) return { deny: true, reason: "Destructive Git/history mutation is prohibited by NUSA repository policy." };
  }
  for (const pattern of authorityEscalation) {
    if (pattern.test(text)) return { deny: true, reason: "Attempted escalation of NUSA LIVE, production-mutation, broker, or AI authority." };
  }
  for (const pattern of highRiskTransfer) {
    if (pattern.test(text)) return { deny: true, reason: "Potential broker/wallet withdrawal or transfer mutation is not permitted for AI authority." };
  }

  return { deny: false };
}

function main() {
  const input = readInput();
  const result = classify(input);
  if (result.deny) {
    process.stdout.write(JSON.stringify({
      permissionDecision: "deny",
      permissionDecisionReason: `${DENY_REASON} ${result.reason}`
    }));
    return;
  }
  process.stdout.write(JSON.stringify({ permissionDecision: "allow" }));
}

if (require.main === module) main();

module.exports = { classify };
