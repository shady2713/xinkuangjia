# syntax=docker/dockerfile:1
# Task-local MinIO server + mc client image built from official GitHub
# release binaries (upstream Docker Hub / Quay images now return 401).
# No ENTRYPOINT: the compose service sets command/entrypoint.

# Stage 1: download and verify pinned release binaries.
FROM alpine:3.22 AS download
ARG TARGETARCH
WORKDIR /dl
# Pins are per-architecture SHA256 of the exact release artifacts.
RUN set -eu; \
    minio_rel=RELEASE.2025-09-07T16-13-09Z; \
    mc_rel=RELEASE.2025-08-13T08-35-41Z; \
    case "${TARGETARCH:-}" in \
      amd64) \
        minio_sha=7c5bd8512c6e966455b1d198209358b2d191c77a83ab377c4073281065fb855f; \
        mc_sha=01f866e9c5f9b87c2b09116fa5d7c06695b106242d829a8bb32990c00312e891 ;; \
      arm64) \
        minio_sha=5c83cd2cf151717ba0243f73e1c7802ff36e272b67144bdd7f1f7d684fd6f03d; \
        mc_sha=14c8c9616cfce4636add161304353244e8de383b2e2752c0e9dad01d4c27c12c ;; \
      *) \
        echo "unsupported TARGETARCH: '${TARGETARCH:-}' (expected amd64 or arm64)" >&2; \
        exit 1 ;; \
    esac; \
    for sha in "$minio_sha" "$mc_sha"; do \
      case "$sha" in *[!0-9a-f]*) echo "malformed SHA256 pin: $sha" >&2; exit 1 ;; esac; \
      [ "${#sha}" -eq 64 ] || { echo "malformed SHA256 pin: $sha" >&2; exit 1; }; \
    done; \
    wget -q -O minio "https://github.com/minio/minio/releases/download/${minio_rel}/minio.linux-${TARGETARCH}.${minio_rel}"; \
    wget -q -O mc "https://github.com/minio/mc/releases/download/${mc_rel}/mc.linux-${TARGETARCH}.${mc_rel}"; \
    printf '%s  minio\n%s  mc\n' "$minio_sha" "$mc_sha" | sha256sum -c -; \
    chmod 0755 minio mc

# Stage 2: minimal BusyBox runtime with both tools on PATH.
FROM alpine:3.22
COPY --from=download /dl/minio /dl/mc /usr/local/bin/
# Smoke test: both binaries execute on this platform.
RUN minio --version && mc --version
