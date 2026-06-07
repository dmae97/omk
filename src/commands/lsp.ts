import { spawn } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "node:url";
import { defaultLspConfigJson } from "../lsp/default-config.js";
import { t } from "../util/i18n.js";

interface LspCommandOptions {
  printConfig?: boolean;
  check?: boolean;
}

type BundledLspServer = "typescript" | "python";

const BUNDLED_LSP_BINARIES: Record<BundledLspServer, string> = {
  typescript: "typescript-language-server",
  python: "pyright-langserver",
};

function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function platformBinName(binary: string): string {
  return process.platform === "win32" ? `${binary}.cmd` : binary;
}

export function resolveBundledLspBinary(server: BundledLspServer, root = packageRoot()): string {
  const binary = BUNDLED_LSP_BINARIES[server];
  const localBinary = join(root, "node_modules", ".bin", platformBinName(binary));
  return existsSync(localBinary) ? localBinary : binary;
}

function bundledLspArgs(_server: BundledLspServer): string[] {
  return ["--stdio"];
}

export async function lspCommand(server: string = "typescript", options: LspCommandOptions = {}): Promise<void> {
  if (options.printConfig) {
    process.stdout.write(defaultLspConfigJson());
    return;
  }

  if (!isBundledLspServer(server)) {
    throw new Error(t("lsp.unsupportedServer", server));
  }

  const command = resolveBundledLspBinary(server);
  const args = bundledLspArgs(server);

  if (options.check) {
    console.log(`${server}: ${command}`);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${server} LSP terminated by signal ${signal}`));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`${server} LSP exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

function isBundledLspServer(value: string): value is BundledLspServer {
  return value === "typescript" || value === "python";
}
