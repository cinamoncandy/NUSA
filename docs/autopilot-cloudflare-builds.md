# NUSA Autopilot Cloudflare Builds

NUSA uses Cloudflare Workers Builds as the deployment executor for `apps/autopilot`.

## GitHub -> Cloudflare contract

- GitHub `main` remains the source of truth and CI gate.
- Successful CI on `main` promotes the exact verified commit to `cloudflare-production`.
- Cloudflare Workers Builds watches only `cloudflare-production` for production deployment.
- GitHub Actions no longer stores or uses `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` for Worker deployment.
- `liveAuthority=NONE` remains unchanged.
- `productionMutationAllowed=false` remains unchanged.
- `AI authority=ZERO_AUTHORITY` remains unchanged.

## Cloudflare Worker build settings

Connect the existing `nusa-autopilot` Worker to `cinamoncandy/NUSA` using Workers Builds.

- Root directory: `/`
- Production branch: `cloudflare-production`
- Build command: leave empty
- Deploy command: `npx wrangler@4.127.0 deploy --config apps/autopilot/wrangler.jsonc --var NUSA_DEPLOYMENT_REVISION:$WORKERS_CI_COMMIT_SHA`
- Builds for non-production branches: disabled initially
- Path include: `apps/autopilot/**`
- Node.js: `24`

The Worker name must remain `nusa-autopilot`, matching `apps/autopilot/wrangler.jsonc`.

## First activation order

1. Merge this migration PR only after normal exact-head CI passes.
2. In Cloudflare, connect the existing `nusa-autopilot` Worker to the GitHub repository.
3. Select `cloudflare-production` as the production branch.
4. Apply the build settings above.
5. Confirm Cloudflare's GitHub integration is authorized for the repository.
6. Trigger the first build from `cloudflare-production`.
7. Verify `/health` reports the exact `WORKERS_CI_COMMIT_SHA` through `NUSA_DEPLOYMENT_REVISION`.

Do not remove the `cloudflare-production` promotion workflow unless the production gate is deliberately redesigned. Its purpose is to prevent a raw `main` push from becoming a production Worker deployment before GitHub CI succeeds.
