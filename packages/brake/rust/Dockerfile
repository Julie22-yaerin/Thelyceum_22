# Multi-stage Dockerfile for Brake Core in Cloud environments (AWS CloudRun, K8s, Docker)
FROM rust:1.80-alpine as builder

WORKDIR /usr/src/brake-core
COPY . .
RUN apk add --no-libc-dev musl-dev
RUN cargo build --release

FROM alpine:latest
RUN apk add --no-cache ca-certificates
COPY --from=builder /usr/src/brake-core/target/release/brake-core /usr/local/bin/brake-core

ENV BRAKE_ENVIRONMENT=cloud
ENV BRAKE_SLA_MS=1000

ENTRYPOINT ["brake-core"]
