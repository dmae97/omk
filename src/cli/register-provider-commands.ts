import type { Command } from "commander";

function commandOptions<T extends Record<string, unknown>>(command: T | { opts(): T }): T {
  return typeof (command as { opts?: unknown }).opts === "function"
    ? (command as { opts(): T }).opts()
    : command as T;
}

export function registerProviderCommands(program: Command): void {
  program
    .command("auth [provider]")
    .description("Show provider-neutral auth status without reading or printing secret values")
    .option("--json", "Output JSON")
    .option("--doctor", "Include setup/doctor guidance in text output")
    .option("--setup", "Include setup guidance in text output")
    .option("--soft", "Do not set a failing exit code when unavailable")
    .action(async (target, options) => {
      const { authCommand } = await import("../commands/auth.js");
      await authCommand(target, options);
    });

  const provider = program.command("provider").description("Provider routing and availability utilities");
  provider
    .command("list")
    .description("List configured model providers without exposing secrets")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { providerListCommand } = await import("../commands/provider.js");
      await providerListCommand(options);
    });
  provider
    .command("doctor [provider]")
    .description("Check provider availability without exposing credentials")
    .option("--json", "Output JSON")
    .option("--soft", "Do not set a failing exit code when unavailable")
    .action(async (target, options) => {
      const { providerDoctorCommand } = await import("../commands/provider.js");
      await providerDoctorCommand(target, options);
    });
  provider
    .command("oauth [provider]")
    .alias("login")
    .description("Show provider OAuth/login guidance without reading or storing tokens")
    .option("--api-key-env <name>", "Environment variable name for API-key based providers")
    .option("--json", "Output JSON")
    .action(async (target, options) => {
      const { providerOAuthCommand } = await import("../commands/provider.js");
      await providerOAuthCommand(target, options);
    });
  provider
    .command("auth <provider>")
    .description("Configure provider authentication metadata without reading or storing token values")
    .requiredOption("--method <method>", "Auth method: api-key-env | oauth | external-cli | none")
    .option("--api-key-env <name>", "Environment variable name for API-key based providers")
    .option("--json", "Output JSON")
    .action(async (target, options) => {
      const { providerAuthCommand } = await import("../commands/provider.js");
      await providerAuthCommand(target, options);
    });
  provider
    .command("profiles")
    .description("List provider compatibility profiles without reading credentials")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { providerProfilesCommand } = await import("../commands/provider.js");
      await providerProfilesCommand(options);
    });
  provider
    .command("use <provider>")
    .description("Set the default provider/model for OMK sessions")
    .option("--model <model>", "Default model or alias target")
    .option("--authority", "Also mark this provider as authority metadata")
    .option("--json", "Output JSON")
    .action(async (target, options) => {
      const { providerUseCommand } = await import("../commands/provider.js");
      await providerUseCommand(target, options);
    });
  provider
    .command("set <provider>")
    .description("Set provider model/base URL/API key env metadata without storing secret values")
    .option("--model <model>", "Default model or alias target")
    .option("--base-url <url>", "OpenAI-compatible base URL")
    .option("--api-key-env <name>", "Environment variable name for the provider API key")
    .option("--kind <kind>", "Provider kind: kimi-native | openai-compatible | external-cli | codex-cli | local")
    .option("--auth-method <method>", "Auth method metadata: api-key-env | oauth | external-cli | none")
    .option("--json", "Output JSON")
    .action(async (target, options) => {
      const { providerSetCommand } = await import("../commands/provider.js");
      await providerSetCommand(target, options);
    });
  provider
    .command("enable <provider>")
    .description("Enable a provider for routing while keeping the configured authority provider as final authority")
    .option("--json", "Output JSON")
    .action(async (target, options) => {
      const { providerEnableCommand } = await import("../commands/provider.js");
      await providerEnableCommand(target, options);
    });
  provider
    .command("disable <provider> [reason]")
    .description("Disable a provider and force configured authority fallback")
    .option("--json", "Output JSON")
    .action(async (target, reason, options) => {
      const { providerDisableCommand } = await import("../commands/provider.js");
      await providerDisableCommand(target, reason, options);
    });
  const deepseekProvider = provider.command("deepseek").description("Manage DeepSeek opportunistic workers");
  deepseekProvider
    .command("enable")
    .description("Enable DeepSeek opportunistic read-only workers")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { providerDeepSeekEnableCommand } = await import("../commands/provider.js");
      await providerDeepSeekEnableCommand(options);
    });
  deepseekProvider
    .command("disable [reason]")
    .description("Disable DeepSeek workers and force configured authority fallback")
    .option("--json", "Output JSON")
    .action(async (reason, options) => {
      const { providerDeepSeekDisableCommand } = await import("../commands/provider.js");
      await providerDeepSeekDisableCommand(reason, options);
    });
  deepseekProvider
    .command("set")
    .description("Save DeepSeek API key via masked prompt, stdin, or --from-env")
    .option("--from-env <name>", "Read API key from an environment variable")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { providerDeepSeekSetCommand } = await import("../commands/provider.js");
      await providerDeepSeekSetCommand(options);
    });

  const deepseek = program.command("deepseek").description("Manage official DeepSeek API access and OMK provider routing");
  deepseek
    .command("api")
    .alias("set")
    .description("Set the official DeepSeek API key via masked prompt, stdin, or --from-env")
    .option("--from-env <name>", "Read API key from an environment variable")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { providerDeepSeekApiCommand } = await import("../commands/provider.js");
      await providerDeepSeekApiCommand(options);
    });
  deepseek
    .command("enable")
    .description("Enable DeepSeek opportunistic read-only/advisory workers")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { providerDeepSeekEnableCommand } = await import("../commands/provider.js");
      await providerDeepSeekEnableCommand(options);
    });
  deepseek
    .command("disable [reason]")
    .description("Disable DeepSeek workers and force configured authority fallback")
    .option("--json", "Output JSON")
    .action(async (reason, options) => {
      const { providerDeepSeekDisableCommand } = await import("../commands/provider.js");
      await providerDeepSeekDisableCommand(reason, options);
    });
  deepseek
    .command("doctor")
    .alias("status")
    .description("Check DeepSeek API key, enabled state, and balance without exposing credentials")
    .option("--json", "Output JSON")
    .option("--soft", "Do not set a failing exit code when unavailable")
    .action(async (options) => {
      const { providerDoctorCommand } = await import("../commands/provider.js");
      await providerDoctorCommand("deepseek", options);
    });

  const model = program
    .command("model")
    .description("Provider model defaults and user aliases")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { modelListCommand } = await import("../commands/model.js");
      await modelListCommand(commandOptions(options));
    });

  model
    .command("list")
    .description("List provider model defaults and aliases")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { modelListCommand } = await import("../commands/model.js");
      await modelListCommand(commandOptions(options));
    });
  model
    .command("aliases")
    .description("List user model aliases")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { modelAliasesCommand } = await import("../commands/model.js");
      await modelAliasesCommand(commandOptions(options));
    });
  model
    .command("resolve <model>")
    .description("Resolve a model alias to provider/model metadata")
    .option("--json", "Output JSON")
    .action(async (target, options) => {
      const { modelResolveCommand } = await import("../commands/model.js");
      await modelResolveCommand(target, commandOptions(options));
    });
  model
    .command("use <model>")
    .description("Set the default model for OMK sessions")
    .option("--json", "Output JSON")
    .action(async (target, options) => {
      const { modelUseCommand } = await import("../commands/model.js");
      await modelUseCommand(target, commandOptions(options));
    });
  const modelAlias = model.command("alias").description("Manage user model aliases");
  modelAlias
    .command("add <alias> <target>")
    .description("Add a user model alias")
    .option("--json", "Output JSON")
    .action(async (alias, target, options) => {
      const { modelAliasAddCommand } = await import("../commands/model.js");
      await modelAliasAddCommand(alias, target, commandOptions(options));
    });
  modelAlias
    .command("remove <alias>")
    .description("Remove a user model alias")
    .option("--json", "Output JSON")
    .action(async (alias, options) => {
      const { modelAliasRemoveCommand } = await import("../commands/model.js");
      await modelAliasRemoveCommand(alias, commandOptions(options));
    });

  program
    .command("think [level] [variant]")
    .alias("thinking")
    .description("Preview model thinking level or custom variant without changing settings")
    .option("--provider <provider>", "Provider context for supported thinking levels")
    .option("--model <model>", "Model or alias context for the variant")
    .option("--export", "Print shell exports instead of a status table")
    .option("--json", "Output JSON")
    .action(async (level, variant, options) => {
      const { thinkCommand } = await import("../commands/model.js");
      await thinkCommand(level, variant, { ...commandOptions(options), exportEnv: Boolean(options.export) });
    });

  program
    .command("deepseekset")
    .description("Alias: save DeepSeek API key via masked prompt, stdin, or --from-env")
    .option("--from-env <name>", "Read API key from an environment variable")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { providerDeepSeekSetCommand } = await import("../commands/provider.js");
      await providerDeepSeekSetCommand(options);
    });
}
