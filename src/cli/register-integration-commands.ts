import type { Command } from "commander";

export function registerIntegrationCommands(program: Command): void {
  const servarr = program
    .command("servarr")
    .description("Optional Radarr/Sonarr/Lidarr adapter with JSON-friendly output");

  const addCommonOptions = (command: Command): Command => command
    .option("--config-file <path>", "Path to .omk/servarr.yml, .yaml, or .json")
    .option("--servarr-name <name>", "Select a named instance from the config")
    .option("--timeout-ms <ms>", "HTTP request timeout in milliseconds")
    .option("--json", "Output JSON");

  servarr
    .command("config-path")
    .description("Print the default Servarr config path")
    .option("--config-file <path>", "Override config path")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { servarrConfigPathCommand } = await import("../integrations/servarr/commands.js");
      await servarrConfigPathCommand(options);
    });

  servarr
    .command("instances")
    .description("List configured Servarr instances without printing API tokens")
    .option("--config-file <path>", "Path to .omk/servarr.yml, .yaml, or .json")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { servarrInstancesCommand } = await import("../integrations/servarr/commands.js");
      await servarrInstancesCommand(options);
    });

  addCommonOptions(servarr.command("status <service>").description("Fetch system status"))
    .action(async (service, options) => {
      const { servarrStatusCommand } = await import("../integrations/servarr/commands.js");
      await servarrStatusCommand(service, options);
    });

  addCommonOptions(servarr.command("health <service>").description("Fetch health checks"))
    .action(async (service, options) => {
      const { servarrHealthCommand } = await import("../integrations/servarr/commands.js");
      await servarrHealthCommand(service, options);
    });

  addCommonOptions(
    servarr.command("logs <service>")
      .description("Fetch recent logs")
      .option("--limit <n>", "Number of log entries to request", "20")
  ).action(async (service, options) => {
    const { servarrLogsCommand } = await import("../integrations/servarr/commands.js");
    await servarrLogsCommand(service, options);
  });

  addCommonOptions(servarr.command("tasks <service>").description("Fetch scheduled tasks"))
    .action(async (service, options) => {
      const { servarrTasksCommand } = await import("../integrations/servarr/commands.js");
      await servarrTasksCommand(service, options);
    });

  addCommonOptions(servarr.command("list <service>").description("List library resources"))
    .action(async (service, options) => {
      const { servarrListCommand } = await import("../integrations/servarr/commands.js");
      await servarrListCommand(service, options);
    });

  addCommonOptions(servarr.command("search <service> <term>").description("Search remote metadata"))
    .action(async (service, term, options) => {
      const { servarrSearchCommand } = await import("../integrations/servarr/commands.js");
      await servarrSearchCommand(service, term, options);
    });
}
