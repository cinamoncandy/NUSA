#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
const evidencePath=(process.env.NUSA_RUNTIME_PROOF_OUTPUT??"artifacts/autopilot/runtime-proof.json").trim();
const maxAttempts=Number(process.env.NUSA_RUNTIME_SELF_HEAL_MAX_ATTEMPTS??13);
const delayMs=Number(process.env.NUSA_RUNTIME_SELF_HEAL_DELAY_MS??25000);
export function recoveryDecision(evidence){
 const classification=String(evidence?.classification??""); const reason=String(evidence?.reasonCode??"");
 if(["worker_unreachable","worker_receipt_stale","proof_not_scheduled","proof_scheduled_late","head_mismatch_failed_closed"].includes(classification)) return {recoverable:true,reason:`${classification}:${reason||"UNKNOWN"}`};
 if(classification==="proof_invalid"&&reason==="SCHEDULED_RECEIPT_HEAD_INVALID") return {recoverable:true,reason:"scheduled-receipt-state-recovery"};
 return {recoverable:false,reason:`${classification||"unknown"}:${reason||"UNKNOWN"}`};
}
function runVerifier(){return new Promise(resolve=>{const child=spawn(process.execPath,["scripts/verify-autopilot-cloudflare-runtime.mjs"],{stdio:"inherit",env:process.env});child.on("exit",code=>resolve(code??1));child.on("error",()=>resolve(1));});}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function runSelfHeal({verify=runVerifier,wait=sleep,readEvidence=()=>{try{return existsSync(evidencePath)?JSON.parse(readFileSync(evidencePath,"utf8")):null}catch{return null}}}={}){
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>20) throw new Error("SELF_HEAL_ATTEMPT_BUDGET_INVALID");
 if(!Number.isSafeInteger(delayMs)||delayMs<1000||delayMs>60000) throw new Error("SELF_HEAL_DELAY_INVALID");
 for(let attempt=1;attempt<=maxAttempts;attempt+=1){rmSync(evidencePath,{force:true});const code=await verify();if(code===0)return{status:"VERIFIED",attempts:attempt};const decision=recoveryDecision(readEvidence());console.log(`AUTOPILOT_RUNTIME_SELF_HEAL attempt=${attempt} recoverable=${decision.recoverable} reason=${decision.reason}`);if(!decision.recoverable||attempt===maxAttempts)return{status:"FAILED_CLOSED",attempts:attempt,reason:decision.reason};await wait(delayMs);}
 return{status:"FAILED_CLOSED",attempts:maxAttempts,reason:"ATTEMPT_BUDGET_EXHAUSTED"};
}
async function main(){const result=await runSelfHeal();if(result.status!=="VERIFIED"){console.error(`AUTOPILOT_RUNTIME_SELF_HEAL_FAILED:${result.reason}`);process.exitCode=1;return}console.log(`AUTOPILOT_RUNTIME_SELF_HEAL_VERIFIED attempts=${result.attempts}`);}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])main().catch(error=>{console.error(error instanceof Error?error.message:"AUTOPILOT_RUNTIME_SELF_HEAL_FAILED");process.exitCode=1;});
