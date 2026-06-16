# syntax=docker/dockerfile:1.7

FROM oven/bun:1 AS web-builder
WORKDIR /app/web

COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile

COPY web/ ./
RUN bun run build

FROM rust:1-bookworm AS rust-builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY --from=web-builder /app/web/dist ./web/dist

RUN cargo build --release

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=rust-builder /app/target/release/nas /usr/local/bin/nas
COPY --from=web-builder /app/web/dist ./web/dist

ENV NAS_BIND=0.0.0.0:3000
ENV NAS_DATA_DIR=/data
ENV NAS_FILES_DIR=/data/files
ENV NAS_SESSION_TTL_HOURS=12

VOLUME ["/data"]
EXPOSE 3000

CMD ["nas"]
