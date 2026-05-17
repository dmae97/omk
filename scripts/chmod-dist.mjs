import { chmod } from "node:fs/promises";

if (process.platform !== "win32") {
  await Promise.all([
    "dist/cli.js",
    "dist/mcp/omk-project-server.js",
    "dist/mcp/acp-server.js",
    "dist/mcp/host.js",
  ].map((file) => chmod(file, 0o755)));
}
