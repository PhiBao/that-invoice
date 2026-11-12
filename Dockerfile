# That Invoice: Rust API + Next.js web in one image (Fly.io).
#   fly deploy      (builds remotely)
#   docker build -t that-invoice . && docker run --rm -p 3000:3000 --env-file .env that-invoice

# ── 1. Rust API ─────────────────────────────────────────────
FROM rust:1-bookworm AS api
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY contracts ./contracts
COPY services ./services
RUN cargo build --release -p that-invoice-api

# ── 2. Web ──────────────────────────────────────────────────
FROM node:22-bookworm-slim AS web
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY scripts/package.json ./scripts/package.json
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile
# The web app proxies /api/* to the API running in the same container.
ENV API_URL=http://127.0.0.1:8787 NEXT_TELEMETRY_DISABLED=1
RUN pnpm --dir apps/web build

# ── 3. Runtime ──────────────────────────────────────────────
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=api /src/target/release/that-invoice-api /app/that-invoice-api
COPY --from=web /src/apps/web/.next/standalone /app/web
COPY --from=web /src/apps/web/.next/static /app/web/apps/web/.next/static
COPY --from=web /src/apps/web/public /app/web/apps/web/public
COPY deploy/entrypoint.sh /app/entrypoint.sh
ENV NODE_ENV=production DATA_DIR=/data NEAR_NETWORK=testnet RUST_LOG=info
EXPOSE 3000
CMD ["/app/entrypoint.sh"]
