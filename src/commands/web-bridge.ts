import { buildInstallHostInstructions, getWebBridgeStatus } from "../web-bridge/status.js";
import { runWebBridgeNativeHost } from "../web-bridge/native-host.js";

export interface WebBridgeJsonOption {
  json?: boolean;
}

export interface WebBridgeInstallHostOptions extends WebBridgeJsonOption {
  extensionId?: string;
  write?: boolean;
  browser?: "chrome" | "chromium" | "brave";
}

export async function webBridgeStatusCommand(options: WebBridgeJsonOption = {}): Promise<void> {
  const report = await getWebBridgeStatus();
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printStatus(report);
}

export async function webBridgeDoctorCommand(options: WebBridgeJsonOption = {}): Promise<void> {
  const report = await getWebBridgeStatus();
  const doctor = {
    ok: report.ok,
    command: "web-bridge doctor",
    checkedAt: report.checkedAt,
    ready: report.ready,
    installed: report.installed,
    enabled: report.enabled,
    checks: report.checks,
    status: report,
  };
  if (options.json) {
    console.log(JSON.stringify(doctor, null, 2));
    return;
  }
  console.log("OMK Web Bridge doctor");
  for (const check of report.checks) {
    console.log(`- ${check.severity}: ${check.message}`);
  }
  if (!report.ready) {
    console.log("Install native host: omk web-bridge install-host");
  }
}

export async function webBridgeInstallHostCommand(options: WebBridgeInstallHostOptions = {}): Promise<void> {
  const result = await buildInstallHostInstructions({
    extensionId: options.extensionId,
    write: Boolean(options.write),
    browser: options.browser,
  });
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.wrote) {
    console.log(`Wrote native host manifest: ${result.manifestPath}`);
    console.log(`Wrote native host wrapper: ${result.wrapperPath}`);
    return;
  }
  console.log("OMK Web Bridge install instructions");
  for (const line of result.instructions) console.log(line);
  if (result.manifestPath) console.log(`Native manifest path: ${result.manifestPath}`);
  if (result.wrapperPath) console.log(`Native host wrapper path: ${result.wrapperPath}`);
  if (result.manifest) {
    console.log("Manifest preview:");
    console.log(JSON.stringify(result.manifest, null, 2));
  }
  if (!result.ok) process.exitCode = 1;
}

export async function webBridgeNativeHostCommand(): Promise<void> {
  await runWebBridgeNativeHost();
}

function printStatus(report: Awaited<ReturnType<typeof getWebBridgeStatus>>): void {
  console.log("OMK Web Bridge status");
  console.log(`- enabled: ${report.enabled}`);
  console.log(`- ready: ${report.ready}`);
  console.log(`- extension template: ${report.extension.manifestPath}`);
  console.log(`- native host installed: ${report.installed ? report.nativeHost.installedPath : "no"}`);
  console.log(`- MCP: ${report.mcp.command} ${report.mcp.args.join(" ")}`);
  console.log(`- latest page context: ${report.artifacts.latestContextExists ? report.artifacts.latestContextPath : "none"}`);
}
