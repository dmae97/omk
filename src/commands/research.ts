import { runShell } from "../util/shell.js";
import { getProjectRoot, injectKimiGlobals } from "../util/fs.js";
import { join } from "path";
import { style } from "../util/theme.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { defaultScopedRoleAgentFile, writeScopedAgentFile } from "../util/scoped-agent-file.js";

export interface ResearchOptions {
  query: string;
  agentFile?: string;
}

const KIMI_INSTALL_HINT = process.platform === "win32"
  ? "Install: Invoke-RestMethod https://code.kimi.com/install.ps1 | Invoke-Expression"
  : "Install: curl -LsSf https://code.kimi.com/install.sh | bash";

export async function researchCommand(options: ResearchOptions): Promise<void> {
  const root = getProjectRoot();
  const agentFile = options.agentFile ?? join(root, ".omk", "agents", "roles", "researcher.yaml");

  // Verify kimi is available
  const kimiCheck = await runShell("kimi", ["--version"], { timeout: 10000 });
  if (kimiCheck.failed) {
    console.error(style.red("✖ Kimi CLI is not installed or not in PATH."));
    console.error(style.gray(`  ${KIMI_INSTALL_HINT}`));
    process.exit(1);
  }

  const resources = await getOmkResourceSettings();
  const scopedAgentFile = await writeScopedAgentFile({
    baseAgentFile: agentFile,
    outputFile: defaultScopedRoleAgentFile(root, undefined, "researcher"),
    role: "researcher",
    resources,
  });

  const args = [
    "--print",
    "--agent-file", scopedAgentFile,
  ];
  await injectKimiGlobals(args, {
    role: "researcher",
    mcpScope: resources.mcpScope,
    skillsScope: resources.skillsScope,
    hooksScope: resources.hooksScope,
  });
  args.push("--prompt", options.query);

  console.log(style.gray(`Running Kimi researcher with query: ${options.query}`));
  console.log(style.gray(`Agent file: ${scopedAgentFile}`));
  console.log();

  const result = await runShell("kimi", args, {
    stdio: "inherit",
    timeout: 300_000,
  });

  if (result.failed) {
    process.exit(result.exitCode ?? 1);
  }
}
