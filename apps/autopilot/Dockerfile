FROM node:24-bookworm-slim

COPY --from=docker.io/cloudflare/sandbox:next /container-server/sandbox /sandbox

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git jq unzip zip \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@11.7.0 --activate

WORKDIR /workspace
ENTRYPOINT ["/sandbox"]
