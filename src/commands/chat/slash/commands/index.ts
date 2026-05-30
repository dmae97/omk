import type { SlashCommandSpec } from "../types.js";
import { buildDiagnosticsSlashCommands } from "./diagnostics.js";
import { buildHarnessSlashCommands } from "./harness.js";
import { buildRoutingSlashCommands } from "./routing.js";
import { buildSessionSlashCommands } from "./session.js";
import { buildToolPlaneSlashCommands } from "./tool-plane.js";
import { buildUiSlashCommands } from "./ui.js";

export function buildNativeChatSlashCommands(): SlashCommandSpec[] {
  return [
    ...buildSessionSlashCommands(),
    ...buildRoutingSlashCommands(),
    ...buildToolPlaneSlashCommands(),
    ...buildUiSlashCommands(),
    ...buildDiagnosticsSlashCommands(),
    ...buildHarnessSlashCommands(),
  ];
}
