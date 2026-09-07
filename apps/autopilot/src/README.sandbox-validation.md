# Cloudflare Sandbox validation boundary

The Worker route `POST /coding/sandbox/validate` validates a bounded repository patch inside the configured Cloudflare Sandbox container.

The route requires the existing coding-runner bearer token, validates a full `CodingExecutionEnvelope`, rejects authority-sensitive or out-of-scope patches, checks the patch with `git apply --check`, applies it only inside the ephemeral sandbox, and runs locked install, build, architecture, safety, and AI-architecture checks before returning a checkpoint.

This path does not push to GitHub, mutate production authority, or access LIVE trading credentials. The invariant remains `liveAuthority=NONE`, `productionMutationAllowed=false`, and `aiAuthority=ZERO_AUTHORITY`.
