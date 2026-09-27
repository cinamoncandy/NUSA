import { createHash } from "node:crypto";
import type { AutopilotFailureClass } from "./executionTelemetry";
import { JevShadowProvider } from "../../cloud/src/ai/jevShadowProvider";
import { JevShadowRouter } from "../../cloud/src/ai/jevShadowRouter";
import { createJevWorkflowFailurePacket, projectJevWorkflowFailureReceipt, type JevWorkflowFailureReceipt } from "../../cloud/src/ai/jevWorkflowFailureDecision";

interface RunnerRequestLike {
  readonly headSha: string;
  readonly workflowRunId: number;
  readonly executionId: string;
  readonly dedupeKey: string;
  readonly reason: string;
}
interface JevEnv {
  readonly NUSA_JEV_SHADOW_ENABLED?: string;
  readonly NUSA_JEV_API_KEY?: string;
  readonly NUSA_JEV_ENDPOINT?: string;
  readonly NUSA_JEV_TIMEOUT_MS?: string;
}
const enabled=(value:string|undefined)=>value?.trim().toLowerCase()==="true";

export async function observeJevCodingFailureShadow(input:{
  readonly runnerRequest: RunnerRequestLike;
  readonly failureReason: string|null;
  readonly failureClass: AutopilotFailureClass;
  readonly env: JevEnv;
}):Promise<JevWorkflowFailureReceipt|null>{
  if(!input.failureReason || input.failureClass!=="deterministic") return null;
  const request=input.runnerRequest;
  const fingerprint=createHash("sha256").update(JSON.stringify({
    headSha:request.headSha,workflowRunId:request.workflowRunId,executionId:request.executionId,
    dedupeKey:request.dedupeKey,failureReason:input.failureReason
  })).digest("hex");
  const packet=createJevWorkflowFailurePacket({
    decisionId:`jev:wf:${request.workflowRunId}:${fingerprint.slice(0,16)}`,
    taskId:(request.reason.match(/(?:github-issue|issue)-[0-9]+/i)?.[0]?.toLowerCase() ?? `autopilot:${request.dedupeKey}`).slice(0,160),
    executionId:request.executionId,
    sourceMainSha:request.headSha.toLowerCase(),
    stateFingerprint:`sha256:${fingerprint}`,
    workflowName:"CI",
    workflowRunId:request.workflowRunId,
    conclusion:"failure",
    evidenceRefs:[`github:workflow-run:${request.workflowRunId}@${request.headSha.toLowerCase()}`]
  });
  const apiKey=input.env.NUSA_JEV_API_KEY?.trim();
  const endpoint=input.env.NUSA_JEV_ENDPOINT?.trim();
  const rawTimeout=input.env.NUSA_JEV_TIMEOUT_MS?.trim();
  const timeoutMs=rawTimeout ? Number(rawTimeout) : undefined;
  let provider:JevShadowProvider|null=null;
  if(enabled(input.env.NUSA_JEV_SHADOW_ENABLED) && apiKey && endpoint){
    try { provider=new JevShadowProvider({apiKey,endpoint,timeoutMs}); } catch { provider=null; }
  }
  const router=new JevShadowRouter(provider ? (value)=>provider!.classify(value) : async()=>{ throw new Error("JEV_PROVIDER_UNAVAILABLE"); });
  const shadow=await router.observe(packet as unknown as Readonly<Record<string,unknown>>, {
    NUSA_JEV_SHADOW_ENABLED: enabled(input.env.NUSA_JEV_SHADOW_ENABLED) ? "true" : "false"
  });
  return projectJevWorkflowFailureReceipt(packet,shadow,provider ? "jev-shadow" : "deterministic-fallback",new Date().toISOString());
}
