export interface OmkLspServerConfig {
  command: string;
  args: string[];
  languages: string[];
  rootPatterns: string[];
  bundled: boolean;
  description: string;
}

export interface OmkLspConfig {
  version: 1;
  enabled: boolean;
  defaultServer: "typescript" | "python";
  servers: Record<string, OmkLspServerConfig>;
}

export const DEFAULT_LSP_CONFIG: OmkLspConfig = {
  version: 1,
  enabled: true,
  defaultServer: "typescript",
  servers: {
    typescript: {
      command: "omk",
      args: ["lsp", "typescript"],
      languages: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
      rootPatterns: ["tsconfig.json", "jsconfig.json", "package.json"],
      bundled: true,
      description: "Bundled TypeScript LSP via typescript-language-server --stdio",
    },
    python: {
      command: "omk",
      args: ["lsp", "python"],
      languages: ["python"],
      rootPatterns: ["pyproject.toml", "requirements.txt", "uv.lock", "setup.py"],
      bundled: true,
      description: "Bundled Python LSP via pyright-langserver --stdio",
    },
  },
};

export function defaultLspConfigJson(): string {
  return `${JSON.stringify(DEFAULT_LSP_CONFIG, null, 2)}\n`;
}
