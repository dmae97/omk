#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const probeVersions = args.has("--probe");

function isWsl() {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
}

function findCommand(names) {
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];

  for (const name of names) {
    const hasExtension = /\.[a-z0-9]+$/i.test(name);
    const candidates = hasExtension ? [name] : extensions.map((ext) => `${name}${ext}`);
    for (const directory of pathEntries) {
      for (const candidate of candidates) {
        const fullPath = join(directory, candidate);
        if (existsSync(fullPath)) return { command: name, path: fullPath };
      }
    }
  }
  return null;
}

function resolvePackage(name, directory = process.cwd()) {
  try {
    const require = createRequire(join(directory, "package.json"));
    require.resolve(`${name}/package.json`);
    return true;
  } catch {
    return false;
  }
}

function probeVersion(found) {
  if (!found || !probeVersions) return null;
  const result = spawnSync(found.path, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.error) return { ok: false, detail: result.error.name };
  const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(0, 200);
  return { ok: result.status === 0, detail };
}

const wsl = isWsl();
const nativeCua = findCommand(["cua-driver"]);
const windowsCua = wsl ? findCommand(["cua-driver.exe"]) : null;
const stagehandInstalled = resolvePackage("@browserbasehq/stagehand");
const stagehandExtensionDirectory = join(process.cwd(), ".omk", "extensions", "omk-computeruse-stagehand");
const stagehandExtensionInstalled = resolvePackage("@browserbasehq/stagehand", stagehandExtensionDirectory);
const browserbaseMcpInstalled = resolvePackage("@browserbasehq/mcp");

const notes = [
  "This inventory does not read credential values or prove MCP connectivity.",
  "Check the live OMK MCP inventory separately for Playwright and Chrome DevTools.",
];

if (wsl) {
  notes.push(
    windowsCua
      ? "Windows cua-driver.exe is visible through WSL interop; the upstream WSL path remains experimental and needs an end-to-end smoke test."
      : "No Windows cua-driver.exe was found on WSL PATH; do not use the Linux driver to control Windows UI.",
  );
}

const report = {
  schemaVersion: "1",
  platform: process.platform,
  architecture: process.arch,
  wsl,
  runtimes: {
    cuaDriver: {
      nativeFound: Boolean(nativeCua),
      nativeVersionProbe: probeVersion(nativeCua),
      windowsInteropFound: Boolean(windowsCua),
      windowsInteropVersionProbe: probeVersion(windowsCua),
    },
    stagehandCore: {
      installedInCurrentProject: stagehandInstalled,
      installedInProjectExtension: stagehandExtensionInstalled,
    },
    browserbaseMcp: { installedInCurrentProject: browserbaseMcpInstalled },
  },
  notes,
};

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(`platform: ${report.platform}/${report.architecture}${wsl ? " (WSL)" : ""}`);
  console.log(`cua-driver: ${nativeCua ? "found" : "not found"}`);
  if (wsl) console.log(`cua-driver.exe interop: ${windowsCua ? "found (experimental)" : "not found"}`);
  console.log(`Stagehand core package: ${stagehandInstalled || stagehandExtensionInstalled ? "found" : "not found"}`);
  console.log(`Browserbase MCP package: ${browserbaseMcpInstalled ? "found" : "not found"}`);
  for (const note of notes) console.log(`note: ${note}`);
}
