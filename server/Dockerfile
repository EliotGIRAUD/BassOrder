# BassOrder API — image multi-stage
FROM rust:1-bookworm AS build
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/release/bassorder-api /usr/local/bin/bassorder-api
RUN mkdir -p /data
ENV BASSORDER_API_ADDR=0.0.0.0:8787
ENV BASSORDER_DB=/data/bassorder.db
EXPOSE 8787
VOLUME ["/data"]
CMD ["bassorder-api"]
