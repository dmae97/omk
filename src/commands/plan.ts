import { join } from "path";
import { runShell } from "../util/shell.js";
import { getOmkPath, getProjectRoot, pathExists, injectKimiGlobals, readTextFile } from "../util/fs.js";
import { header, status, label } from "../util/theme.js";
import { createOmkSessionEnv, createOmkSessionId } from "../util/session.js";
import { t } from "../util/i18n.js";
import { detectSpecKitContext, injectSpecKitPrompt } from "./spec.js";
import { resolveSpecifyCli } from "./specify.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { defaultScopedRoleAgentFile, writeScopedAgentFile } from "../util/scoped-agent-file.js";

export async function planCommand(
  goal: string,
  options: { thinking?: string; runId?: string; specKit?: boolean; noSpecKit?: boolean }
): Promise<void> {
  const root = getProjectRoot();
  const agentFile = getOmkPath("agents/roles/architect.yaml");
  const sessionId = createOmkSessionId("plan");

  if (!(await pathExists(agentFile))) {
    console.error(status.error(t("plan.architectMissing")));
    process.exit(1);
  }

  // Determine spec-kit flag
  let specFlag: "yes" | "no" | "auto" = "auto";
  if (options.noSpecKit) specFlag = "no";
  else if (options.specKit) specFlag = "yes";

  const specCtx = await detectSpecKitContext(specFlag);

  // If --spec-kit explicitly requested but no artifacts, try init
  if (options.specKit && !specCtx.useSpecKit) {
    const specifyDir = join(root, ".specify");
    const hasSpecifyDir = await pathExists(specifyDir);

    if (!hasSpecifyDir) {
      if (process.stdin.isTTY) {
        // Ask user
        const { createInterface } = await import("readline");
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise<string>((resolve) => {
          rl.question(".specify/ not found. Initialize spec-kit now? [y/N] ", (ans) => {
            rl.close();
            resolve(ans.trim().toLowerCase());
          });
        });
        if (answer === "y" || answer === "yes") {
          const cli = await resolveSpecifyCli();
          if (!cli) {
            console.error(status.error("spec-kit CLI not found. Install: pip install specify-cli"));
            process.exit(1);
          }
          const initResult = await runShell(cli.cmd, [...cli.args, "init", "--here"], {
            cwd: root,
            timeout: 60000,
            stdio: "inherit",
          });
          if (initResult.failed) {
            process.exit(initResult.exitCode);
          }
          // Re-detect after init
          const reloaded = await detectSpecKitContext("yes");
          Object.assign(specCtx, reloaded);
        }
      } else {
        // Non-TTY: read config
        const config = await readTextFile(join(root, ".omk", "config.toml"), "");
        const autoInitMatch = config.match(/^\s*auto_init\s*=\s*"([^"]+)"/m);
        const autoInit = autoInitMatch?.[1] ?? "ask";
        if (autoInit === "always") {
          const cli = await resolveSpecifyCli();
          if (cli) {
            await runShell(cli.cmd, [...cli.args, "init", "--here"], { cwd: root, timeout: 60000 });
            const reloaded = await detectSpecKitContext("yes");
            Object.assign(specCtx, reloaded);
          }
        }
      }
    }
  }

  let promptText = t("plan.prompt", goal);

  if (specCtx.useSpecKit) {
    promptText = injectSpecKitPrompt(promptText, specCtx);
    console.log(label("Spec Kit", "integrated"));
  }

  console.log(header(t("plan.header")));
  console.log(label(t("plan.goalLabel"), goal) + "\n");

  const env = createOmkSessionEnv(root, sessionId);
  if (options.runId) {
    env.OMK_RUN_ID = options.runId;
  }
  const resources = await getOmkResourceSettings();
  const scopedAgentFile = await writeScopedAgentFile({
    baseAgentFile: agentFile,
    outputFile: defaultScopedRoleAgentFile(root, env.OMK_RUN_ID ?? sessionId, "architect"),
    role: "architect",
    resources,
  });

  const args = ["--print", "--output-format=stream-json"];
  args.push("--agent-file", scopedAgentFile);

  await injectKimiGlobals(args, {
    role: "architect",
    mcpScope: resources.mcpScope,
    skillsScope: resources.skillsScope,
    hooksScope: resources.hooksScope,
  });

  args.push("-p", promptText);

  const result = await runShell("kimi", args, {
    timeout: 120000,
    cwd: root,
    env,
  });
  console.log(result.stdout);
  if (result.failed) {
    console.error(result.stderr);
    process.exit(result.exitCode);
  }
}
