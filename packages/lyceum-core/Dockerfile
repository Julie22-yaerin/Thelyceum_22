# ── lyceum-core: native PyO3 build for Linux production ─────────────────────
#
# Stage 1 compiles the Rust extension natively on the target platform and
# packages a manylinux wheel with maturin. Stage 2 installs that wheel into a
# slim Python runtime — the image a customer actually runs in production
# contains no toolchain at all.
#
# Build:
#   docker build -t lyceum-core .
#
# Cross-arch (on Apple Silicon, for x86_64 prod):
#   docker buildx build --platform linux/amd64 -t lyceum-core .
#
# Runtime contract: the wheel is abi3 (PyO3 abi3-py39), so one wheel serves
# Python 3.9+ on any Linux. ZERO copies of payload bytes between Python and
# Rust is a code property, not a build property — see src/lib.rs.

# ── Stage 1: build the wheel ────────────────────────────────────────────────
FROM rust:1.82-bookworm AS builder

# Python headers for PyO3's abi3 build are required; debian's python3-dev is
# enough because we build against the stable ABI.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-dev python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir "maturin>=1.7,<2.0"

WORKDIR /build
COPY Cargo.toml pyproject.toml README.md ./
COPY src ./src

# --release + lto/codegen-units=1/panic=abort come from Cargo.toml.
# --compatibility manylinux_2_28 → installs on Ubuntu 20.04+/Debian 12+/RHEL 9+.
RUN /opt/venv/bin/maturin build --release --compatibility manylinux_2_28 \
    --out /build/wheels

# ── Stage 2: production runtime ─────────────────────────────────────────────
FROM python:3.11-slim-bookworm AS runtime

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# The wheel from stage 1; nothing else crosses the boundary.
COPY --from=builder /build/wheels /wheels
RUN pip install --no-cache-dir /wheels/*.whl && rm -rf /wheels

# Your application code (the openai.Client() wrapper, agent loop, etc.).
COPY python ./python
ENV PYTHONPATH=/app/python

# Smoke test baked in: proves the extension imports and the state machine
# passes its own invariants before the app ever runs.
CMD ["python", "-c", "from example_openai import demo; demo(); print('lyceum_core: OK')"]
