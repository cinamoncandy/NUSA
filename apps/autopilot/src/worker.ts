import { Sandbox } from "@cloudflare/sandbox";
import baseWorker, { type Env as BaseEnv } from "./index";
import { ExecutionCoordinator } from "./executionCoordinator";
import { CloudflareSandboxBackend, type CloudflareSandboxNamespace } from "./cloudflareSandboxBackend";
import { validateCodingExecutionEnvelope } from "./codingExecutionEnvelope";
import { validatePatchInSandbox } from "./sandboxPatchValidator";

export { Sandbox, ExecutionCoordinator };

interface WorkerEnv extends BaseEnv {
  Sandbox?: CloudflareSandboxNamespace;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" },
});

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

const worker = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/coding/sandbox/validate") {
      const configured = env.NUSA_CODING_RUNNER_TOKEN?.trim();
      const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
      if (!configured) return json({ error: "CODING_RUNNER_TOKEN_NOT_CONFIGURED", status: "INTERFACE_READY" }, 503);
      if (!provided || !constantTimeEqual(configured, provided)) return json({ error: "CODING_RUNNER_UNAUTHORIZED" }, 401);
      if (!env.Sandbox) return json({ error: "CLOUDFLARE_SANDBOX_NOT_CONFIGURED", status: "INTERFACE_READY" }, 503);

      try {
        const body = await request.json() as { envelope?: unknown; patch?: unknown };
        const allowedRepository = env.NUSA_GITHUB_REPOSITORY?.trim() || "cinamoncandy/NUSA";
        const envelope = validateCodingExecutionEnvelope(body.envelope, allowedRepository);
        if (typeof body.patch !== "string") throw new Error("SANDBOX_PATCH_REQUIRED");
        const backend = new CloudflareSandboxBackend(env.Sandbox);
        const result = await validatePatchInSandbox(backend, { envelope, patch: body.patch });
        return json({
          accepted: true,
          ...result,
          liveAuthority: "NONE",
          productionMutationAllowed: false,
          aiAuthority: "ZERO_AUTHORITY",
        }, 200);
      } catch (error) {
        return json({
          accepted: false,
          error: error instanceof Error ? error.message : "SANDBOX_PATCH_VALIDATION_FAILED",
          liveAuthority: "NONE",
          productionMutationAllowed: false,
          aiAuthority: "ZERO_AUTHORITY",
        }, 400);
      }
    }

    return baseWorker.fetch(request, env);
  },
  scheduled: baseWorker.scheduled,
};

export default worker;
