import { style, box } from "../util/theme.js";

interface ProviderAuthInfo {
  name: string;
  cli: string;
  install: string;
  envKey?: string;
  loginCmd?: string;
  authType: "cli-login" | "api-key" | "oauth";
  status: "available" | "not-installed" | "needs-key";
}

async function checkProvider(name: string): Promise<boolean> {
  try {
    const { execSync } = await import("child_process");
    execSync(`which ${name} 2>/dev/null`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function getProviders(): Promise<ProviderAuthInfo[]> {
  const hasKimi = await checkProvider("kimi");
  const hasCodex = await checkProvider("codex");
  const hasOpencode = await checkProvider("opencode");
  const hasCommandcode = await checkProvider("commandcode");
  const hasDeepseek = Boolean(process.env.DEEPSEEK_API_KEY);

  return [
    {
      name: "Kimi for Coding",
      cli: "kimi",
      install: "npm install -g @anthropic-ai/kimi-code",
      loginCmd: "kimi login",
      authType: "oauth",
      status: hasKimi ? "available" : "not-installed",
    },
    {
      name: "OpenAI Codex",
      cli: "codex",
      install: "npm install -g @openai/codex",
      loginCmd: "codex login",
      authType: "oauth",
      status: hasCodex ? "available" : "not-installed",
    },
    {
      name: "OpenCode",
      cli: "opencode",
      install: "cargo install opencode",
      loginCmd: "opencode login",
      authType: "oauth",
      status: hasOpencode ? "available" : "not-installed",
    },
    {
      name: "CommandCode",
      cli: "commandcode",
      install: "npm install -g commandcode",
      loginCmd: "commandcode login",
      authType: "oauth",
      status: hasCommandcode ? "available" : "not-installed",
    },
    {
      name: "DeepSeek",
      cli: "deepseek",
      install: "",
      envKey: "DEEPSEEK_API_KEY",
      authType: "api-key",
      status: hasDeepseek ? "available" : "needs-key",
    },
  ];
}

export async function authCommand(): Promise<void> {
  const providers = await getProviders();

  const available = providers.filter((p) => p.status === "available");
  const unavailable = providers.filter((p) => p.status !== "available");

  const lines: string[] = [];

  if (available.length > 0) {
    lines.push(style.phosphorBold("Active Providers:"));
    for (const p of available) {
      const typeTag = p.authType === "api-key" ? style.phosphor(" api-key") : style.phosphorDim(" oauth");
      lines.push(`  ${style.phosphorBold("✓")} ${style.phosphor(p.name)} (${p.cli})${typeTag}`);
    }
    lines.push("");
  }

  if (unavailable.length > 0) {
    lines.push(style.phosphorDim("Setup Required:"));
    for (const p of unavailable) {
      if (p.status === "not-installed") {
        lines.push(`  ${style.phosphorDim("○")} ${p.name} — ${p.install}`);
      } else if (p.status === "needs-key") {
        lines.push(`  ${style.phosphorDim("○")} ${p.name} — export ${p.envKey}="sk-..."`);
      }
    }
    lines.push("");
  }

  lines.push(
    style.phosphorDim("Usage:"),
    `  omk chat --provider kimi     ${style.phosphorDim("# Use Kimi for Coding")}`,
    `  omk chat --provider codex    ${style.phosphorDim("# Use OpenAI Codex")}`,
    `  omk chat --provider deepseek ${style.phosphorDim("# Use DeepSeek API")}`,
    `  omk chat --provider auto     ${style.phosphorDim("# Auto-detect best available")}`,
  );

  console.log(box(lines, "Auth Status"));
}
