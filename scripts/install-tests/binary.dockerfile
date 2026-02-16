# Test binary build from local source
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y curl ca-certificates unzip build-essential && rm -rf /var/lib/apt/lists/*

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain nightly
ENV PATH="/root/.cargo/bin:$PATH"

# Copy local repo
WORKDIR /repo
COPY . .

# Build native addon and binary
RUN bun install --frozen-lockfile
RUN bun --cwd=packages/natives run build:native
RUN cd packages/coding-agent && bun run build:binary

# Install binary and native addon to PATH
RUN mkdir -p /root/.local/bin && \
    cp packages/coding-agent/dist/omp /root/.local/bin/ && \
    cp packages/natives/native/pi_natives.linux-x64-modern.node /root/.local/bin/ && \
    cp packages/natives/native/pi_natives.linux-x64-baseline.node /root/.local/bin/
ENV PATH="/root/.local/bin:$PATH"

# Verify
RUN omp --version
