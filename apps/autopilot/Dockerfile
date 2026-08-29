FROM docker.io/cloudflare/sandbox:next

USER root

# NUSA autonomous engineering runtime. Keep this image on the same preview
# release line as @cloudflare/sandbox@next.
RUN corepack enable \
    && corepack prepare pnpm@11.7.0 --activate

WORKDIR /workspace
