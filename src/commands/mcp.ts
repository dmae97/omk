export { mcpListCommand } from "./mcp/list.js";
export { mcpDoctorCommand, buildMcpDoctorReport } from "./mcp/doctor.js";
export type {
  McpDoctorOptions,
  McpDoctorCheck,
  McpDoctorSourceReport,
  McpDoctorServerReport,
  McpDoctorReport,
} from "./mcp/doctor.js";
export { repairMcpDoctorIssues } from "./mcp/doctor-fix.js";
export type { McpDoctorFixReport } from "./mcp/doctor-fix.js";
export { mcpTestCommand, mcpPrewarmCommand } from "./mcp/test.js";
export {
  mcpRemoveCommand,
  mcpAddCommand,
  mcpInstallCommand,
  mcpBulkInstallCommand,
  mcpSyncGlobalCommand,
  mcpMigrateCommand,
} from "./mcp/config.js";
export type { BulkInstallEntry, BulkInstallResult } from "./mcp/config.js";
