import { confirm, password } from "@inquirer/prompts";
import { ExitPromptError } from "@inquirer/core";
import { getProjectRoot } from "../../util/fs.js";
import { style, status } from "../../util/theme.js";
import { t } from "../../util/i18n.js";
import { maybeAskForGitHubStar } from "../../util/first-run-star.js";
import { getDeepSeekProviderStatus, setDeepSeekApiKey } from "../../providers/deepseek/deepseek-config.js";
import {
  RECOMMENDED_MCP_SERVERS,
  getDefaultSelections,
  type McpCatalogEntry,
} from "../../mcp/server-catalog.js";
import { mcpBulkInstallCommand } from "../mcp.js";
import { redactSecretishText, isDisabledEnvValue, isEnabledEnvValue } from "./utils.js";
import type { InitCommandOptions } from "./types.js";

export function shouldImportUserSkills(options: InitCommandOptions): boolean {
  const env = options.env ?? process.env;
  return Boolean(options.importUserSkills) || isEnabledEnvValue(env.OMK_INIT_IMPORT_USER_SKILLS);
}

export function explicitLocalUserRuntime(options: InitCommandOptions): boolean | undefined {
  const env = options.env ?? process.env;
  const profile = options.profile?.trim().toLowerCase() ?? "";
  if (Boolean(options.localUser)
    || isEnabledEnvValue(env.OMK_INIT_LOCAL_USER)
    || ["local", "personal", "trusted-local"].includes(profile)) {
    return true;
  }
  if (isDisabledEnvValue(env.OMK_INIT_LOCAL_USER)) return false;
  return undefined;
}

export async function resolveLocalUserRuntime(options: InitCommandOptions, homeDir: string): Promise<boolean> {
  const explicit = explicitLocalUserRuntime(options);
  if (explicit !== undefined) return explicit;
  if (!isInitInteractiveSetupEligible(options)) return false;
  return askLocalUserRuntimeDuringInit(options, homeDir);
}

export async function askLocalUserRuntimeDuringInit(options: InitCommandOptions, homeDir: string): Promise<boolean> {
  try {
    const useLocalGlobal = options.promptLocalUserRuntime
      ? await options.promptLocalUserRuntime({ homeDir })
      : await confirm({
          message: "MCP 설정: 기존 로컬 글로벌 ~/.kimi MCP/skills를 그대로 사용할까요? (No = omk-project만 시작하고 여기서 MCP를 추가)",
          default: false,
        });
    if (useLocalGlobal) {
      console.log(status.ok("Init MCP mode: using local/global ~/.kimi MCP and skills at runtime."));
    } else {
      console.log(style.gray("Init MCP mode: project only; start with omk-project and add MCPs here later."));
    }
    return useLocalGlobal;
  } catch (error) {
    if (error instanceof ExitPromptError) return false;
    console.log(status.warn(`MCP runtime prompt failed; falling back to project-only mode: ${redactSecretishText(error)}`));
    return false;
  }
}

export function isInitInteractiveSetupEligible(options: InitCommandOptions): boolean {
  const env = options.env ?? process.env;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;

  if (options.interactiveSetup === false) return false;
  if (isDisabledEnvValue(env.OMK_INIT_PROMPTS)) return false;
  if (env.CI || env.GITHUB_ACTIONS) return false;
  return Boolean(stdin.isTTY && stdout.isTTY);
}

export async function runMcpServerSelectionDuringInit(options: InitCommandOptions): Promise<void> {
  if (!isInitInteractiveSetupEligible(options)) return;
  const env = options.env ?? process.env;
  if (isDisabledEnvValue(env.OMK_INIT_MCP_SERVERS)) return;

  try {
    const defaultSelections = getDefaultSelections();
    const choices = RECOMMENDED_MCP_SERVERS.map((server) => ({
      name: `${server.name} — ${server.description} [${server.category}]`,
      value: server,
      checked: defaultSelections.includes(server.name),
    }));

    const { checkbox: checkboxPrompt } = await import("@inquirer/prompts");
    const selected = await checkboxPrompt({
      message: "Select additional MCP servers to install (Space to toggle, Enter to confirm):",
      choices,
    });

    if (!selected || selected.length === 0) {
      console.log(style.gray("No additional MCP servers selected."));
      return;
    }

    console.log(style.purple(`   📦 Installing ${selected.length} MCP server(s) in parallel...`));

    const root = getProjectRoot();
    const { join } = await import("path");
    const entries = selected.map((server: McpCatalogEntry) => ({
      name: server.name,
      command: server.command,
      args: server.args.map((arg) => arg.replace("${PROJECT_ROOT}", root).replace("${DB_PATH}", join(root, ".omk", "memory", "graph.db"))),
      env: server.env,
      startupTimeoutSec: server.startupTimeoutSec,
    }));

    const result = await mcpBulkInstallCommand(entries);

    for (const name of result.installed) {
      console.log(status.ok(`Installed MCP server: ${name}`));
    }
    for (const name of result.skipped) {
      console.log(style.gray(`Skipped (already exists): ${name}`));
    }
    for (const { name, error } of result.failed) {
      console.log(status.warn(`Failed to install ${name}: ${error}`));
    }
  } catch (error) {
    if (error instanceof ExitPromptError) return;
    console.log(status.warn(`MCP server selection failed: ${redactSecretishText(error)}`));
  }
}

export async function runInitInteractiveSetup(options: InitCommandOptions, homeDir: string): Promise<void> {
  if (!isInitInteractiveSetupEligible(options)) return;

  const { getOmkVersionSync } = await import("../../util/version.js");
  await maybeAskForGitHubStar({
    version: getOmkVersionSync(),
    homeDir,
    env: options.env,
    argv: options.argv ?? ["node", "omk", "init"],
    stdin: options.stdin,
    stdout: options.stdout,
    commandName: "init",
    prompt: options.promptGitHubStar,
    starRepo: options.starRepo,
  });

  await runMcpServerSelectionDuringInit(options);

  await maybeAskForDeepSeekApiKeyDuringInit(options, homeDir);
}

export async function maybeAskForDeepSeekApiKeyDuringInit(
  options: InitCommandOptions,
  homeDir: string,
): Promise<void> {
  const env = options.env ?? process.env;
  if (isDisabledEnvValue(env.OMK_INIT_DEEPSEEK_PROMPT)) return;

  try {
    const providerOptions = { env, homeDir };
    const currentStatus = await getDeepSeekProviderStatus(providerOptions);
    if (currentStatus.apiKeySet) {
      console.log(style.gray(t("init.deepseekAlreadyConfigured")));
      return;
    }

    const shouldConfigure = options.promptDeepSeekSetup
      ? await options.promptDeepSeekSetup()
      : await confirm({
          message: t("init.deepseekPrompt"),
          default: false,
        });
    if (!shouldConfigure) return;

    const enteredCredential = options.promptDeepSeekApiKey
      ? await options.promptDeepSeekApiKey()
      : await password({
          message: t("init.deepseekKeyPrompt"),
          mask: "*",
        });

    await setDeepSeekApiKey(enteredCredential, providerOptions);
    console.log(status.ok(t("init.deepseekSaved")));
  } catch (error) {
    if (error instanceof ExitPromptError) return;
    console.log(status.warn(t("init.deepseekSetupFailed", redactSecretishText(error))));
  }
}
