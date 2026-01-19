# Test binary build from local source
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y curl ca-certificates unzip && rm -rf /var/lib/apt/lists/*

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Copy local repo
WORKDIR /repo
COPY . .

# Build binary
RUN bun install --frozen-lockfile
RUN cd packages/coding-agent && bun run build:binary

# Install binary to PATH
RUN mkdir -p /root/.local/bin && cp packages/coding-agent/dist/omp /root/.local/bin/
ENV PATH="/root/.local/bin:$PATH"

# Verify
RUN omp --version
