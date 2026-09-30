import { createHash } from "node:crypto";
import type { AutopilotFailureClass } from "./executionTelemetry";
import { logAiCall } from "./aiCallTelemetry";
import { JevShadowProvider } from "../../cloud/src/ai/jevShadowProvider";
import { JevWorkersAiProvider, type JevWorkersAiReceipt, type JevWorkersAiRuntime } from "../../cloud/src/ai/jevWorkersAiProvider";
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
  readonly NUSA_JEV_MODEL_IDENTITY?: string;
  readonly AI?: JevWorkersAiRuntime;
}
const enabled=(value:string|undefined)=>value?.trim().toLowerCase()==="true";
// Jev is a bounded SHADOW classifier, not the coding model. Prefer the lower-neuron
// 8B model here; strict output validation and the deterministic fallback remain
// unchanged, and production coding keeps its separately governed model choice.
const DEFAULT_WORKERS_AI_JEV_MODEL="@cf/meta/llama-3.1-8b-instruct-fast";
const PROVIDER_STOP_REASONS=new Set([
  "WORKERS_AI_DAILY_QUOTA_EXHAUSTED",
  "WORKERS_AI_RATE_LIMITED",
  "WAITING_PROVIDER_CAPACITY",
  "BLOCKED_RATE_LIMIT",
]);

function boundedFailureEvidence(value:string):string {
  return value
    .replace(/(authorization|token|secret|password|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/ig,"$1=[REDACTED]")
    .replace(/[^\x20-\x7E]/g," ")
    .replace(/\s+/g," ")
    .trim()
    .slice(0,512);
}

export async function observeJevCodingFailureShadow(input:{
  readonly runnerRequest: RunnerRequestLike;
  readonly failureReason: string|null;
  readonly failureClass: AutopilotFailureClass;
  readonly env: JevEnv;
}):Promise<JevWorkflowFailureReceipt|null>{
  if(!input.failureReason || input.failureClass!=="deterministic" || PROVIDER_STOP_REASONS.has(input.failureReason)) return null;
  const request=input.runnerRequest;
  const failureEvidence=boundedFailureEvidence(input.failureReason);
  if(!failureEvidence) return null;
  const fingerprint=createHash("sha256").update(JSON.stringify({
    headSha:request.headSha,workflowRunId:request.workflowRunId,executionId:request.executionId,
    dedupeKey:request.dedupeKey,failureReason:failureEvidence
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
  const shadowEnabled=enabled(input.env.NUSA_JEV_SHADOW_ENABLED);
  const apiKey=input.env.NUSA_JEV_API_KEY?.trim();
  const endpoint=input.env.NUSA_JEV_ENDPOINT?.trim();
  const rawTimeout=input.env.NUSA_JEV_TIMEOUT_MS?.trim();
  const timeoutMs=rawTimeout ? Number(rawTimeout) : undefined;
  const workersAiModel=input.env.NUSA_JEV_MODEL_IDENTITY?.trim() || DEFAULT_WORKERS_AI_JEV_MODEL;

  let classifier:((value:Readonly<Record<string,unknown>>)=>Promise<unknown>)|null=null;
  let modelIdentity="deterministic-fallback";
  const nativeReceiptBox:{value:JevWorkersAiReceipt|null}={value:null};

  if(shadowEnabled && input.env.AI){
    try {
      const instrumentedAi:JevWorkersAiRuntime={
        async run(model,value){
          try {
            const response=await input.env.AI!.run(model,value);
            logAiCall({caller:"C3_JEV",model,attempt:1,promptChars:value.prompt.length,response});
            return response;
          } catch(error) {
            logAiCall({caller:"C3_JEV",model,attempt:1,promptChars:value.prompt.length,response:{}});
            throw error;
          }
        }
      };
      const provider=new JevWorkersAiProvider({ai:instrumentedAi,model:workersAiModel,timeoutMs});
      classifier=async(value)=>{
        const result=await provider.classifyDetailed(Object.freeze({
          ...value,
          failureEvidence:Object.freeze({
            failureClass:input.failureClass,
            failureReason:failureEvidence,
          }),
        }));
        nativeReceiptBox.value=result.receipt;
        return result.decision;
      };
      modelIdentity="workers-ai:"+workersAiModel;
    } catch { classifier=null; }
  }
  if(!classifier && shadowEnabled && apiKey && endpoint){
    try {
      const provider=new JevShadowProvider({apiKey,endpoint,timeoutMs});
      classifier=(value)=>provider.classify(Object.freeze({
        ...value,
        failureEvidence:Object.freeze({
          failureClass:input.failureClass,
          failureReason:failureEvidence,
        }),
      }));
      modelIdentity="jev-shadow";
    } catch { classifier=null; }
  }

  const router=new JevShadowRouter(classifier ?? (async()=>{ throw new Error("JEV_PROVIDER_UNAVAILABLE"); }));
  const shadow=await router.observe(packet as unknown as Readonly<Record<string,unknown>>, {
    NUSA_JEV_SHADOW_ENABLED: shadowEnabled ? "true" : "false"
  });
  const nativeReceipt=nativeReceiptBox.value;
  if(nativeReceipt){
    console.log(JSON.stringify({
      event:"NUSA_JEV_WORKERS_AI_SHADOW_CALL",decisionId:packet.decisionId,executionId:packet.executionId,sourceMainSha:packet.sourceMainSha,
      provider:nativeReceipt.provider,model:nativeReceipt.model,latencyMs:nativeReceipt.latencyMs,timeoutMs:nativeReceipt.timeoutMs,
      inputFingerprint:nativeReceipt.inputFingerprint,confidence:nativeReceipt.confidence,reasonCode:nativeReceipt.reasonCode,
      promptTokens:nativeReceipt.promptTokens,completionTokens:nativeReceipt.completionTokens,fallbackApplied:shadow.fallbackApplied,
      timestamp:new Date().toISOString(),usableForRouting:false,
      liveAuthority:"NONE",productionMutationAllowed:false,aiAuthority:"ZERO_AUTHORITY"
    }));
  }
  return projectJevWorkflowFailureReceipt(packet,shadow,classifier ? modelIdentity : "deterministic-fallback",new Date().toISOString());
}
