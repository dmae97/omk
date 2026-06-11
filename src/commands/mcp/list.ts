import { collectMcpConfigs } from "../../util/fs.js";
import { getOmkResourceSettings } from "../../util/resource-profile.js";
import { style, header, bullet } from "../../util/theme.js";
import { maskSensitiveText } from "../../util/secret-mask.js";
import {
  collectServers,
  formatArgsForDisplay,
  formatMcpEnvKeys,
  resolveAllConfigs,
  sanitizeMcpUrlForDisplay,
  selectEffectiveServer,
} from "./shared.js";

export async function mcpListCommand(): Promise<void> {
  const sources = await resolveAllConfigs();
  const servers = collectServers(sources);
  const resources = await getOmkResourceSettings();
  const activePathOrder = await collectMcpConfigs(resources.mcpScope);
  const activePaths = new Set(activePathOrder);

  console.log(header("MCP Servers"));

  for (const src of sources) {
    const icon = !src.exists ? style.gray("-") : src.parsed ? style.mint("✓") : style.pink("✗");
    const marker = activePaths.has(src.path) ? style.mint(" [active]") : style.gray(" [inactive]");
    const missing = !src.exists ? style.gray(" (not found)") : "";
    console.log(`${icon} ${src.path}${marker}${missing}`);
    if (src.error) console.log(`  ${style.gray(maskSensitiveText(src.error))}`);
  }

  if (servers.size === 0) {
    console.log("\n" + style.gray("No MCP servers configured."));
    return;
  }

  console.log("");
  let duplicateCount = 0;
  for (const [name, info] of servers) {
    const server = selectEffectiveServer(info, activePathOrder);
    const activeSources = info.sources.filter((source) => activePaths.has(source));
    const dup = info.sources.length > 1 ? style.skin(` [duplicate: ${info.sources.length} sources]`) : "";
    if (info.sources.length > 1) duplicateCount++;
    const activeMarker = activeSources.length > 0 ? style.mint(" [active]") : style.gray(" [inactive]");
    console.log(bullet(`${style.purpleBold(name)}${dup}${activeMarker}`, "purple"));
    if (server.url) {
      console.log(`  ${style.gray("url:")} ${sanitizeMcpUrlForDisplay(server.url)}`);
    }
    if (server.command || !server.url) {
      console.log(`  ${style.gray("command:")} ${server.command ? maskSensitiveText(server.command) : style.pink("missing")}`);
    }
    if (server.args && server.args.length > 0) {
      console.log(`  ${style.gray("args:")} ${formatArgsForDisplay(server.args)}`);
    }
    const envKeys = formatMcpEnvKeys(server.env);
    if (envKeys.length > 0) {
      console.log(`  ${style.gray("env:")} ${envKeys.join(", ")}`);
    }
    console.log(`  ${style.gray("from:")} ${info.sources.join(", ")}`);
    if (activeSources.length > 0) {
      console.log(`  ${style.gray("active from:")} ${activeSources.join(", ")}`);
    }
  }

  if (duplicateCount > 0) {
    console.log("");
    console.log(style.skin(`⚠  ${duplicateCount} duplicate server(s) detected. Run \`omk mcp doctor\` for details, or \`omk mcp remove <name>\` to delete a local copy.`));
  }
}
