# Test --source install from local repo
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y curl ca-certificates unzip && rm -rf /var/lib/apt/lists/*

# Install bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Copy local repo
WORKDIR /repo
COPY . .

# Install dependencies and link globally
RUN bun install --frozen-lockfile
RUN cd packages/coding-agent && bun link

# Verify
RUN omp --version
