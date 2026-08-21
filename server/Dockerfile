# BassOrder API — image multi-stage, user non-root
FROM rust:1-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 bassorder \
  && useradd --system --uid 10001 --gid bassorder --home-dir /data --shell /usr/sbin/nologin bassorder \
  && mkdir -p /data \
  && chown -R bassorder:bassorder /data

WORKDIR /app
COPY --from=build /app/target/release/bassorder-api /usr/local/bin/bassorder-api

ENV BASSORDER_API_ADDR=0.0.0.0:8787
ENV BASSORDER_DB=/data/bassorder.db
EXPOSE 8787
VOLUME ["/data"]
USER bassorder:bassorder
CMD ["bassorder-api"]
