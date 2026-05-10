import { basename, join } from "path";
import { execSync } from "child_process";
import { checkCommand, getKimiVersion, runShell } from "../util/shell.js";
import { runOmkSafetySelfTest } from "../util/native-safety.js";
import { getKimiCapabilities } from "../kimi/capability.js";
import { pathExists, getKimiConfigPath, readTextFile, getProjectRoot, getUserHome } from "../util/fs.js";
import { isGitAvailable, getCurrentBranch, getGitStatus } from "../util/git.js";
import { style, status, header, separator } from "../util/theme.js";
import { getGlobalMemoryConfigPath, isGraphMemoryBackend, loadMemorySettings, usesLocalGraphBackend, usesKuzuBackend } from "../memory/memory-config.js";
import { getOmkResourceSettings } from "../util/resource-profile.js";
import { t } from "../util/i18n.js";
import { formatBytes } from "../util/output-buffer.js";
import { getOmkVersionSync } from "../util/version.js";
import { resolveBundledLspBinary } from "./lsp.js";
import { detectPackageManager } from "../mcp/quality-gate.js";
import { discoverRoutingInventory } from "../orchestration/routing.js";

function semverGt(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10));
  const pb = b.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail" | "info";
  message: string;
  metadata?: Record<string, unknown>;
}

interface CheckCategory {
  title: string;
  checks: () => Promise<CheckResult[]>;
}

interface JsonFileDiagnostic {
  path: string;
  exists: boolean;
  valid: boolean;
  error?: string;
}

interface AgentToolDeclarations {
  hasAgentTool: boolean;
  hasSearchWeb: boolean;
  hasFetchURL: boolean;
}

const SECRET_KEY_SUBSTRINGS = ["apikey", "token", "password", "secret", "authorization", "bearer", "key"];

function isSecretKey(key: string): boolean {
  const lk = key.toLowerCase();
  return SECRET_KEY_SUBSTRINGS.some((sk) => lk === sk || lk.endsWith(sk));
}

function redactSecrets(obj: unknown): unknown {
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSecrets);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && isSecretKey(key)) {
      result[key] = "***";
    } else {
      result[key] = redactSecrets(value);
    }
  }
  return result;
}

function isNpmLauncherCommand(command: string | undefined): boolean {
  if (!command) return false;
  const executable = command.trim().split(/\s+/)[0];
  if (!executable) return false;
  const name = basename(executable).toLowerCase();
  return ["npm", "npx", "npm.cmd", "npx.cmd", "npm.exe", "npx.exe"].includes(name);
}

function isExpectedGlobalKimiFile(name: string): boolean {
  const expected = new Set([
    "AGENTS.md",
    "config.toml",
    "device_id",
    "kimi.json",
    "latest_version.txt",
    "mcp.json",
    "mcp.manifest.json",
    "omk.memory.toml",
    "setup.md",
    "user.md",
  ]);
  return (
    expected.has(name)
    || /^config\.toml\.bak(?:[-_].*)?$/.test(name)
    || /^mcp(?:\.manifest)?\.json\.bak(?:[-_].*)?$/.test(name)
    || /\.json:Zone\.Identifier$/i.test(name)
  );
}

async function inspectJsonFile(filePath: string): Promise<JsonFileDiagnostic> {
  if (!(await pathExists(filePath))) return { path: filePath, exists: false, valid: false };

  try {
    JSON.parse(await readTextFile(filePath, "{}"));
    return { path: filePath, exists: true, valid: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { path: filePath, exists: true, valid: false, error: `Invalid JSON: ${message}` };
  }
}

async function readAgentToolDeclarations(root: string): Promise<AgentToolDeclarations | null> {
  const rootYamlPath = join(root, ".omk", "agents", "root.yaml");
  if (!(await pathExists(rootYamlPath))) return null;
  const rootYaml = await readTextFile(rootYamlPath, "");
  return {
    hasAgentTool: /\bAgent\b/.test(rootYaml),
    hasSearchWeb: /\bSearchWeb\b/.test(rootYaml),
    hasFetchURL: /\bFetchURL\b/.test(rootYaml),
  };
}

export async function doctorCommand(options: { json?: boolean; soft?: boolean } = {}): Promise<void> {
  const resources = await getOmkResourceSettings();
  const root = getProjectRoot();

  // Categories run in parallel (omk-style)
  const categories: CheckCategory[] = [
    { title: "Runtime", checks: () => runtimeChecks(resources) },
    { title: "Toolchain", checks: () => toolchainChecks(root) },
    { title: "Kimi CLI", checks: () => kimiChecks(root) },
    { title: "Project", checks: () => projectChecks(root) },
    { title: "OMK Scaffold", checks: () => omkChecks(root) },
    { title: "MCP & Skills", checks: () => mcpSkillsChecks(root) },
    { title: "Memory", checks: () => memoryChecks() },
    { title: "Security", checks: () => securityChecks(root) },
  ];

  const categoryResults = await Promise.all(
    categories.map(async (cat) => {
      const results = await cat.checks();
      return { title: cat.title, results };
    })
  );

  const allResults: CheckResult[] = [];
  for (const { results } of categoryResults) {
    allResults.push(...results);
  }

  if (options.json) {
    const find = (name: string) => allResults.find((r) => r.name === name);
    const findMsg = (name: string) => find(name)?.message ?? null;
    const findOk = (name: string) => find(name)?.status === "ok";
    const findMeta = (name: string, key: string) => find(name)?.metadata?.[key] ?? null;

    const warnings = allResults
      .filter((r) => r.status === "warn")
      .map((r) => ({ name: r.name, message: r.message }));
    const errors = allResults
      .filter((r) => r.status === "fail")
      .map((r) => ({ name: r.name, message: r.message }));

    const data = {
      environment: {
        platform: process.platform,
        arch: process.arch,
        omkRuntime: {
          profile: resources.profile,
          ramGb: resources.totalMemoryGb,
          workers: resources.maxWorkers,
          bufferBytes: resources.shellMaxBufferBytes,
        },
        npmGlobalBin: findMsg("npm global bin"),
      },
      kimi: {
        installed: findOk("Kimi CLI"),
        version: findMsg("Kimi CLI"),
        runnable: findOk("Kimi Runnable"),
        session: findMsg("Kimi Session"),
        config: findOk("Kimi Config"),
        hooks: findOk("OMK Hooks"),
        capabilities: findMsg("Kimi Capabilities"),
        agentFile: findOk("Kimi Agent File"),
        webTools: findOk("Kimi Web Tools"),
        swarmStatus: findMsg("Kimi Swarm"),
        installGuide: "curl -LsSf https://code.kimi.com/install.sh | bash or see https://github.com/dmae97/oh-my-kimi#install",
      },
      git: {
        installed: findOk("Git Installed"),
        available: findOk("Git Available"),
        isRepo: findOk("Git Repo"),
        clean: findOk("Git Clean"),
        safeDirectoryWarning: !findOk("Git Safe Directory"), // true if there IS a warning
        warning:
          allResults
            .filter((r) => r.status === "warn" && r.name.startsWith("Git"))
            .map((r) => r.message)[0] ?? null,
      },
      node: {
        version: process.version,
        npmGlobalBin: findMsg("npm global bin"),
      },
      scaffold: {
        initialized: findOk(".omk dir"),
        writable: findOk(".omk writable"),
        rootYaml: findOk("root.yaml"),
        okabeAgents: findMsg("Okabe Agents"),
        rootPrompt: findMsg("Root Prompt"),
        hooksExecutable: findOk("Hooks Exec"),
      },
      globalSync: {
        memory: findMsg("Global Memory"),
        graphMemory: findMsg("Graph Memory"),
        globalPollution: findMsg("Global Pollution"),
        mcp: findMsg("OMK MCP"),
        skills: findMsg(".kimi/skills"),
        agentSkills: findMsg(".agents/skills"),
        globalMcp: findMsg("Global MCP"),
        globalSkills: findMsg("Global Skills"),
      },
      security: {
        dangerousConfig: findMsg("Dangerous Config"),
      },
      rustSafety: {
        cargo: findMsg("Rust Cargo"),
        rustc: findMsg("Rust Compiler"),
        crate: findMsg("Rust Safety Crate"),
        native: findMsg("Rust Safety Native"),
        nativeSource: findMeta("Rust Safety Native", "source"),
        nativePlatformArch: findMeta("Rust Safety Native", "platformArch"),
        nativeBuiltFromSource: findMeta("Rust Safety Native", "builtFromSource"),
        nativePath: findMeta("Rust Safety Native", "path"),
      },
    };
    const output = {
      ok: errors.length === 0,
      command: "doctor",
      checkedAt: new Date().toISOString(),
      data,
      ...data,
      warnings,
      errors,
    };
    console.log(JSON.stringify(output, null, 2));
    if (errors.length > 0 && !options.soft) process.exit(1);
    return;
  }

  console.log(header("oh-my-kimi doctor"));
  console.log(separator());

  for (const { title, results } of categoryResults) {
    console.log(style.purpleBold(`\n  ${title}`));
    for (const r of results) {
      const icon = r.status === "ok" ? "✅" : r.status === "warn" ? "⚠️" : r.status === "fail" ? "❌" : "ℹ️";
      console.log(`    ${icon} ${r.name.padEnd(16)} ${r.message}`);
    }
  }

  console.log();
  const fails = allResults.filter((r) => r.status === "fail").length;
  const warns = allResults.filter((r) => r.status === "warn").length;

  if (fails > 0) {
    console.log(status.error(t("doctor.failures", fails, warns)));
    if (!options.soft) process.exit(1);
  } else if (warns > 0) {
    console.log(status.warn(t("doctor.warnings", warns)));
  } else {
    console.log(status.ok(t("doctor.allPassed")));
  }

  // ── Interactive update prompt for OMK Version ──
  const omkVersionResult = allResults.find((r) => r.name === "OMK Version");
  if (omkVersionResult?.status === "warn" && process.stdin.isTTY && process.stdout.isTTY && !options.json) {
    try {
      const { select } = await import("@inquirer/prompts");
      const answer = await select(
        {
          message: `A new version of oh-my-kimi is available. Update now?`,
          choices: [
            { name: "YES — run npm i -g @oh-my-kimi/cli", value: "yes" },
            { name: "NO — skip this update", value: "no" },
          ],
        },
        { signal: AbortSignal.timeout(30_000) }
      );
      if (answer === "yes") {
        console.log(style.gray("Running update…"));
        const updateResult = await runShell("npm", ["i", "-g", "@oh-my-kimi/cli"], { timeout: 120_000 });
        if (updateResult.failed) {
          console.log(status.error(`Update failed: ${updateResult.stderr.trim() || updateResult.stdout.trim()}`));
          process.exit(1);
        } else {
          console.log(status.ok("Update completed successfully. Restart your terminal to use the new version."));
        }
      } else {
        console.log(style.gray("Update skipped."));
      }
    } catch (err) {
      if (err instanceof Error && err.name === "ExitPromptError") {
        console.log(style.gray("Update prompt cancelled."));
        process.exit(0);
      }
      // Non-TTY or timeout — silently skip
    }
  }
}

// ── Runtime ───────────────────────────────────────────────────

async function runtimeChecks(resources: Awaited<ReturnType<typeof getOmkResourceSettings>>): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.replace("v", "").split(".")[0], 10);
  results.push({
    name: "Node.js",
    status: nodeMajor >= 20 ? "ok" : "warn",
    message: nodeMajor >= 20 ? `${nodeVersion}` : `${nodeVersion} ${t("doctor.nodeRecommend")}`,
  });

  try {
    // npm 10+ removed `npm bin -g`; use `npm prefix -g` exclusively
    const prefix = execSync("npm prefix -g", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"], timeout: 5000 }).trim();
    const npmBin = join(prefix, process.platform === "win32" ? "" : "bin");
    if (npmBin) {
      const pathDelimiter = process.platform === "win32" ? ";" : ":";
      const inPath = process.env.PATH?.split(pathDelimiter).some((p) => p === npmBin || npmBin.startsWith(p));
      results.push({
        name: "npm global bin",
        status: inPath ? "ok" : "warn",
        message: inPath ? npmBin : `${npmBin} not in PATH`,
      });

      // PATH diagnosis: check if omk is in npm global bin but not in PATH
      const omkPath = join(npmBin, "omk");
      if (!inPath && (await pathExists(omkPath))) {
        results.push({
          name: "omk in PATH",
          status: "warn",
          message: `omk found at ${omkPath} but not in PATH — add ${npmBin} to your shell profile`,
        });
      }
    } else {
      results.push({ name: "npm global bin", status: "warn", message: "Unable to detect npm global bin" });
    }
  } catch {
    results.push({ name: "npm global bin", status: "warn", message: "npm bin detection failed" });
  }

  results.push({
    name: "OMK Runtime",
    status: resources.profile === "lite" ? "info" : "ok",
    message: `profile=${resources.profile}, RAM=${resources.totalMemoryGb}GB, workers=${resources.maxWorkers}, buffer=${formatBytes(resources.shellMaxBufferBytes)}`,
  });

  const currentVersion = getOmkVersionSync();
  try {
    const latest = execSync("npm view @oh-my-kimi/cli version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    if (latest && semverGt(latest, currentVersion)) {
      results.push({
        name: "OMK Version",
        status: "warn",
        message: `${currentVersion} → ${latest} available. Run: npm i -g @oh-my-kimi/cli`,
      });
    } else {
      results.push({
        name: "OMK Version",
        status: "ok",
        message: `${currentVersion} (latest)`,
      });
    }
  } catch {
    results.push({
      name: "OMK Version",
      status: "info",
      message: `${currentVersion} (offline or registry unreachable)`,
    });
  }

  return results;
}

// ── Toolchain ─────────────────────────────────────────────────

async function toolchainChecks(root: string): Promise<CheckResult[]> {
  const [gitAvailable, jqExists, tmuxExists, cargoExists, rustcExists, rustSafetyCrateExists] = await Promise.all([
    isGitAvailable(),
    checkCommand("jq"),
    checkCommand("tmux"),
    checkCommand("cargo"),
    checkCommand("rustc"),
    pathExists(join(root, "crates", "omk-safety", "Cargo.toml")),
  ]);

  const results: CheckResult[] = [];

  // Git checks — semantically distinct for correct JSON output
  results.push({
    name: "Git Installed",
    status: gitAvailable ? "ok" : "fail",
    message: gitAvailable ? "Installed" : t("doctor.gitNotFound"),
  });

  results.push({
    name: "Git Available",
    status: gitAvailable ? "ok" : "fail",
    message: gitAvailable ? "Available" : t("doctor.gitNotFound"),
  });

  if (gitAvailable) {
    const repoCheck = await runShell("git", ["rev-parse", "--git-dir"], { cwd: root, timeout: 5000 });
    const isRepo = !repoCheck.failed;
    const safeDirIssueFromRepoCheck = repoCheck.failed && repoCheck.stderr.includes("safe.directory");

    let repoMessage = isRepo ? "Repository detected" : t("doctor.gitNotRepo");
    if (safeDirIssueFromRepoCheck) {
      repoMessage = `Repository detected but blocked by safe.directory — run: git config --global --add safe.directory "${root}"`;
    }
    results.push({
      name: "Git Repo",
      status: isRepo ? "ok" : "warn",
      message: repoMessage,
    });

    if (isRepo) {
      const [branch, gitStatus] = await Promise.all([getCurrentBranch(), getGitStatus()]);
      results.push({
        name: "Git Clean",
        status: gitStatus.clean ? "ok" : "warn",
        message: t("doctor.gitBranchChanges", branch ?? "?", gitStatus.changes),
      });

      const statusResult = await runShell("git", ["status"], { cwd: root, timeout: 5000 });
      const safeDirIssue = statusResult.failed && statusResult.stderr.includes("safe.directory");
      results.push({
        name: "Git Safe Directory",
        status: safeDirIssue ? "warn" : "ok",
        message: safeDirIssue ? "safe.directory configuration needed" : "no safe.directory issues",
      });
    } else {
      results.push({
        name: "Git Clean",
        status: "info",
        message: "not a git repository",
      });
      results.push({
        name: "Git Safe Directory",
        status: safeDirIssueFromRepoCheck ? "warn" : "info",
        message: safeDirIssueFromRepoCheck ? "safe.directory configuration needed" : "not a git repository",
      });
    }
  } else {
    results.push({
      name: "Git Repo",
      status: "info",
      message: t("doctor.gitNotFound"),
    });
    results.push({
      name: "Git Clean",
      status: "info",
      message: t("doctor.gitNotFound"),
    });
    results.push({
      name: "Git Safe Directory",
      status: "info",
      message: t("doctor.gitNotFound"),
    });
  }

  results.push({
    name: "jq",
    status: jqExists ? "ok" : "fail",
    message: jqExists ? t("doctor.jqInstalled") : t("doctor.jqMissing"),
  });

  results.push({
    name: "tmux",
    status: tmuxExists ? "ok" : "info",
    message: tmuxExists ? t("doctor.tmuxInstalled") : t("doctor.tmuxRecommend"),
  });

  results.push({
    name: "Rust Cargo",
    status: cargoExists ? "ok" : "info",
    message: cargoExists ? "cargo available" : "cargo not found — Rust safety harness checks will be skipped",
  });

  results.push({
    name: "Rust Compiler",
    status: rustcExists ? "ok" : "info",
    message: rustcExists ? "rustc available" : "rustc not found — Rust safety harness checks will be skipped",
  });

  results.push({
    name: "Rust Safety Crate",
    status: rustSafetyCrateExists ? "ok" : "info",
    message: rustSafetyCrateExists ? "crates/omk-safety configured" : "no Rust safety crate configured",
  });

  results.push(await rustSafetyNativeCheck(root));

  const pkgMgr = detectPackageManager(root);
  results.push({ name: "Pkg Manager", status: "ok", message: `${pkgMgr} detected` });

  const tsconfigExists = await pathExists(join(root, "tsconfig.json"));
  results.push({
    name: "TypeScript",
    status: tsconfigExists ? "ok" : "info",
    message: tsconfigExists ? "tsconfig.json found" : "No tsconfig.json — TS project?",
  });

  return results;
}

async function rustSafetyNativeCheck(root: string): Promise<CheckResult> {
  const result = await runOmkSafetySelfTest({ root });
  return {
    name: "Rust Safety Native",
    status: result.status,
    message: result.message,
    metadata: {
      source: result.source,
      platformArch: result.platformArch,
      builtFromSource: result.builtFromSource,
      path: result.path,
      checks: result.checks,
    },
  };
}

// ── Kimi CLI ──────────────────────────────────────────────────

async function kimiChecks(root: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const kimiExists = await checkCommand("kimi");
  const agentTools = await readAgentToolDeclarations(root);
  const agentYamlDeclaresWebTools = Boolean(agentTools?.hasSearchWeb && agentTools.hasFetchURL);

  if (kimiExists) {
    const version = await getKimiVersion();
    results.push({ name: "Kimi CLI", status: "ok", message: version ?? t("doctor.kimiInstalled") });
    results.push({
      name: "Kimi Runnable",
      status: version ? "ok" : "warn",
      message: version ? t("doctor.kimiRunnable") : t("doctor.kimiRunFailed"),
    });

    // Session indicator check
    try {
      const kimiConfigPath = getKimiConfigPath();
      const kimiConfig = await readTextFile(kimiConfigPath, "");
      const hasIndicators = /default_model|session|credential/.test(kimiConfig);
      results.push({
        name: "Kimi Session",
        status: hasIndicators ? "ok" : "warn",
        message: hasIndicators ? "config indicators present" : "kimi login may be required",
      });
    } catch {
      results.push({ name: "Kimi Session", status: "warn", message: "config read failed" });
    }
  } else {
    results.push({ name: "Kimi CLI", status: "fail", message: t("doctor.kimiNotFound") });
    results.push({ name: "Kimi Install Guide", status: "info", message: "curl -LsSf https://code.kimi.com/install.sh | bash or see https://github.com/dmae97/oh-my-kimi#install" });
    results.push({ name: "Kimi Capabilities", status: "info", message: "unknown — kimi not installed" });
  }

  const kimiConfigPath = getKimiConfigPath();
  const kimiConfigExists = await pathExists(kimiConfigPath);
  results.push({
    name: "Kimi Config",
    status: kimiConfigExists ? "ok" : "warn",
    message: kimiConfigExists ? t("doctor.kimiConfigExists") : t("doctor.kimiConfigMissing"),
  });

  if (kimiConfigExists) {
    const kimiContent = await readTextFile(kimiConfigPath, "");
    const hasOmkHooks = kimiContent.includes("# >>> omk managed hooks");
    results.push({
      name: "OMK Hooks",
      status: hasOmkHooks ? "ok" : "warn",
      message: hasOmkHooks ? t("doctor.hooksSynced") : t("doctor.hooksRecommendSync"),
    });
  }

  // Capability probe
  if (kimiExists) {
    const caps = getKimiCapabilities();
    const supported = [
      caps.model && "model",
      caps.thinking && "thinking",
      caps.temperature && "temperature",
      caps.topP && "top-p",
      caps.variant && "variant",
    ].filter(Boolean);
    results.push({
      name: "Kimi Capabilities",
      status: supported.length > 0 ? "ok" : "info",
      message: supported.length > 0 ? supported.join(", ") : "no extended sampling flags",
    });

    results.push({
      name: "Kimi Agent File",
      status: caps.agentFile ? "ok" : "warn",
      message: caps.agentFile ? "--agent-file supported" : "--agent-file not detected — update Kimi CLI",
    });

    const webToolStatus = caps.webTools ? "ok" : agentYamlDeclaresWebTools ? "info" : "warn";
    results.push({
      name: "Kimi Web Tools",
      status: webToolStatus,
      message: caps.webTools
        ? "SearchWeb / FetchURL available"
        : agentYamlDeclaresWebTools
          ? "web tool declarations present; CLI help does not expose tool availability"
          : "web search tools not detected — may be unavailable",
    });

    results.push({
      name: "Kimi Swarm",
      status: caps.swarmStatus === "available" ? "ok" : caps.swarmStatus === "unavailable" ? "info" : "warn",
      message: caps.swarmStatus === "available"
        ? "K2.6 Agent Swarm platform capability detected"
        : caps.swarmStatus === "unavailable"
          ? "swarm APIs not available in this Kimi version"
          : "unable to detect swarm capability from version",
    });
  }

  // Agent YAML tools check
  if (agentTools) {
    const { hasAgentTool, hasSearchWeb, hasFetchURL } = agentTools;
    const agentToolStatus = hasAgentTool && hasSearchWeb && hasFetchURL ? "ok" : "warn";
    results.push({
      name: "Agent YAML Tools",
      status: agentToolStatus,
      message: hasAgentTool && hasSearchWeb && hasFetchURL
        ? "root.yaml includes Agent, SearchWeb, FetchURL"
        : `root.yaml missing tools: ${[!hasAgentTool && "Agent", !hasSearchWeb && "SearchWeb", !hasFetchURL && "FetchURL"].filter(Boolean).join(", ")}`,
    });
  }

  return results;
}

// ── Project ───────────────────────────────────────────────────

async function projectChecks(root: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const [agentsMdExists, kimiAgentsMdExists] = await Promise.all([
    pathExists(join(root, "AGENTS.md")),
    pathExists(join(root, ".kimi", "AGENTS.md")),
  ]);
  results.push({
    name: "AGENTS.md",
    status: agentsMdExists ? "ok" : "warn",
    message: agentsMdExists ? t("doctor.agentsMdExists") : t("doctor.agentsMdMissing"),
  });
  results.push({
    name: ".kimi/AGENTS.md",
    status: kimiAgentsMdExists ? "ok" : "warn",
    message: kimiAgentsMdExists ? t("doctor.kimiAgentsMdExists") : t("doctor.kimiAgentsMdMissing"),
  });

  return results;
}

// ── OMK Scaffold ──────────────────────────────────────────────

async function omkChecks(root: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const omkDir = join(root, ".omk");
  const omkExists = await pathExists(omkDir);

  results.push({
    name: ".omk dir",
    status: omkExists ? "ok" : "warn",
    message: omkExists ? t("doctor.omkInitialized") : t("doctor.omkInitNeeded"),
  });

  if (omkExists) {
    try {
      const testFile = join(omkDir, ".doctor-write-test");
      const fs = await import("fs/promises");
      await fs.writeFile(testFile, "ok", "utf-8");
      await fs.rm(testFile);
      results.push({ name: ".omk writable", status: "ok", message: "write test passed" });
    } catch {
      results.push({ name: ".omk writable", status: "fail", message: ".omk is not writable" });
    }
  }

  const rootYamlExists = await pathExists(join(omkDir, "agents", "root.yaml"));
  results.push({
    name: "root.yaml",
    status: rootYamlExists ? "ok" : "warn",
    message: rootYamlExists ? t("doctor.rootYamlExists") : t("doctor.rootYamlMissing"),
  });

  const agentYamlPaths = [
    join(omkDir, "agents", "root.yaml"),
    join(omkDir, "agents", "roles", "architect.yaml"),
    join(omkDir, "agents", "roles", "coder.yaml"),
    join(omkDir, "agents", "roles", "explorer.yaml"),
    join(omkDir, "agents", "roles", "planner.yaml"),
    join(omkDir, "agents", "roles", "qa.yaml"),
    join(omkDir, "agents", "roles", "reviewer.yaml"),
  ];
  const agentChecks = await Promise.all(
    agentYamlPaths.map(async (agentPath) => {
      if (!(await pathExists(agentPath))) return { exists: false, extendsOkabe: false };
      const content = await readTextFile(agentPath, "");
      const extendsOkabe = /^\s*extend:\s*(?:\.\.\/|\.)?\/?okabe\.yaml\b/m.test(content);
      return { exists: true, extendsOkabe };
    })
  );
  const totalAgentCount = agentChecks.filter((c) => c.exists).length;
  const okabeAgentCount = agentChecks.filter((c) => c.extendsOkabe).length;
  const okabeBase = await readTextFile(join(omkDir, "agents", "okabe.yaml"), "");
  const okabeBaseHasDMail = okabeBase.includes("kimi_cli.tools.dmail:SendDMail");
  results.push({
    name: "Okabe Agents",
    status: totalAgentCount > 0 && okabeAgentCount === totalAgentCount && okabeBaseHasDMail ? "ok" : "warn",
    message: totalAgentCount > 0 && okabeBaseHasDMail
      ? `${okabeAgentCount}/${totalAgentCount} agents inherit okabe.yaml (SendDMail)`
      : t("doctor.okabeMissing"),
  });

  const rootPromptPath = join(omkDir, "prompts", "root.md");
  let rootPromptValid = false;
  let rootPromptHasAgentsMd = false;
  let rootPromptHasSkills = false;
  if (await pathExists(rootPromptPath)) {
    const rootPrompt = await readTextFile(rootPromptPath, "");
    rootPromptHasAgentsMd = rootPrompt.includes("${KIMI_AGENTS_MD}");
    rootPromptHasSkills = rootPrompt.includes("${KIMI_SKILLS}");
    rootPromptValid = rootPromptHasAgentsMd && rootPromptHasSkills;
  }
  results.push({
    name: "Root Prompt",
    status: rootPromptValid ? "ok" : "warn",
    message: rootPromptValid
      ? t("doctor.rootPromptInjected")
      : t("doctor.rootPromptPartial", !rootPromptHasAgentsMd ? "AGENTS_MD " : "", !rootPromptHasSkills ? "SKILLS" : ""),
  });

  const hooksDir = join(omkDir, "hooks");
  let hooksExecutable = true;
  if (await pathExists(hooksDir)) {
    try {
      const fs = await import("fs/promises");
      const entries = await fs.readdir(hooksDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".sh")) {
          const stat = await fs.stat(join(hooksDir, entry.name));
          if ((stat.mode & 0o111) === 0) hooksExecutable = false;
        }
      }
    } catch { /* ignore */ }
  }
  results.push({
    name: "Hooks Exec",
    status: hooksExecutable ? "ok" : "warn",
    message: hooksExecutable ? t("doctor.hooksExecutable") : t("doctor.hooksNotExecutable"),
  });

  return results;
}

// ── MCP & Skills ──────────────────────────────────────────────

async function mcpSkillsChecks(root: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const kimiSkillsDir = join(root, ".kimi", "skills");
  const agentsSkillsDir = join(root, ".agents", "skills");
  const projectKimiMcpPath = join(root, ".kimi", "mcp.json");
  const omkMcpPath = join(root, ".omk", "mcp.json");
  const globalMcpPath = join(getUserHome(), ".kimi", "mcp.json");
  const [projectKimiMcp, omkMcp, globalMcp, kimiSkillsCount, agentsSkillsCount] = await Promise.all([
    inspectJsonFile(projectKimiMcpPath),
    inspectJsonFile(omkMcpPath),
    inspectJsonFile(globalMcpPath),
    (async () => {
      if (!(await pathExists(kimiSkillsDir))) return 0;
      try {
        const fs = await import("fs/promises");
        const entries = await fs.readdir(kimiSkillsDir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).length;
      } catch { return 0; }
    })(),
    (async () => {
      if (!(await pathExists(agentsSkillsDir))) return 0;
      try {
        const fs = await import("fs/promises");
        const entries = await fs.readdir(agentsSkillsDir, { withFileTypes: true });
        return entries.filter((e) => e.isDirectory()).length;
      } catch { return 0; }
    })(),
  ]);
  results.push({
    name: "Project MCP",
    status: projectKimiMcp.exists ? "ok" : "info",
    message: projectKimiMcp.exists ? t("doctor.mcpExists") : t("doctor.mcpMissing"),
  });
  for (const diagnostic of [omkMcp, projectKimiMcp, globalMcp]) {
    if (!diagnostic.exists || diagnostic.valid) continue;
    results.push({
      name: "MCP JSON",
      status: "fail",
      message: `${diagnostic.path}: ${diagnostic.error ?? "Invalid JSON"}`,
    });
  }
  results.push({
    name: ".kimi/skills",
    status: kimiSkillsCount > 0 ? "ok" : "warn",
    message: kimiSkillsCount > 0 ? t("doctor.skillsExist", kimiSkillsCount) : t("doctor.skillsMissing"),
  });
  results.push({
    name: ".agents/skills",
    status: agentsSkillsCount > 0 ? "ok" : "warn",
    message: agentsSkillsCount > 0 ? t("doctor.agentSkillsExist", agentsSkillsCount) : t("doctor.agentSkillsMissing"),
  });

  const lspConfigPath = join(root, ".omk", "lsp.json");
  const tsLspBinary = resolveBundledLspBinary("typescript");
  const [lspConfigExists, tsLspAvailable] = await Promise.all([
    pathExists(lspConfigPath),
    tsLspBinary.includes("/") || tsLspBinary.includes("\\")
      ? pathExists(tsLspBinary)
      : checkCommand(tsLspBinary),
  ]);
  let lspConfigValid = false;
  if (lspConfigExists) {
    try {
      const parsed = JSON.parse(await readTextFile(lspConfigPath, "{}")) as {
        enabled?: boolean;
        servers?: Record<string, unknown>;
      };
      lspConfigValid = parsed.enabled === true && typeof parsed.servers?.typescript === "object";
    } catch { /* ignore */ }
  }
  results.push({
    name: "Built-in LSP",
    status: lspConfigValid && tsLspAvailable ? "ok" : "warn",
    message: lspConfigValid && tsLspAvailable
      ? `.omk/lsp.json + TypeScript LSP (${tsLspBinary})`
      : t("doctor.lspMissing"),
  });

  let globalMcpCount = 0;
  const stdioMcpServers: string[] = [];
  const npxMcpServers: string[] = [];
  if (globalMcp.valid) {
    const content = await readTextFile(globalMcpPath, "{}");
    const parsed = redactSecrets(JSON.parse(content)) as {
      mcpServers?: Record<string, { command?: string; type?: string }>;
    };
    const servers: Record<string, { command?: string; type?: string }> = parsed.mcpServers ?? {};
    globalMcpCount = Object.keys(servers).length;
    for (const [name, cfg] of Object.entries(servers)) {
      if (cfg.type === "stdio" || !cfg.type) {
        stdioMcpServers.push(name);
        if (isNpmLauncherCommand(cfg.command)) {
          npxMcpServers.push(name);
        }
      }
    }
  }
  results.push({
    name: "Global MCP",
    status: globalMcp.valid && globalMcpCount > 0 ? "ok" : "warn",
    message: globalMcp.valid && globalMcpCount > 0 ? t("doctor.globalMcpSynced", globalMcpCount) : t("doctor.globalMcpMissing"),
  });
  if (stdioMcpServers.length > 0) {
    results.push({
      name: "Global MCP (stdio)",
      status: npxMcpServers.length > 0 ? "warn" : "info",
      message:
        `${stdioMcpServers.join(", ")} — ` +
        (npxMcpServers.length > 0
          ? `npx-based servers (${npxMcpServers.join(", ")}) may fail to connect and crash Kimi CLI sessions. Remove or fix them in ~/.kimi/mcp.json if unused.`
          : "stdio servers detected. Ensure they are available."),
    });
  }

  const globalSkillsDir = join(getUserHome(), ".kimi", "skills");
  const globalSkillsExists = await pathExists(globalSkillsDir);
  let globalSkillCount = 0;
  if (globalSkillsExists) {
    try {
      const fs = await import("fs/promises");
      const entries = await fs.readdir(globalSkillsDir, { withFileTypes: true });
      globalSkillCount = entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).length;
    } catch { /* ignore */ }
  }
  results.push({
    name: "Global Skills",
    status: globalSkillCount > 0 ? "ok" : "info",
    message: globalSkillCount > 0 ? t("doctor.globalSkillsSynced", globalSkillCount) : t("doctor.globalSkillsMissing"),
  });

  // Advanced: routing inventory discovery (uses skills + mcp)
  try {
    const inventory = discoverRoutingInventory(root);
    const skillNames = [...inventory.skills.keys()];
    const mcpNames = [...inventory.mcpServers.keys()];
    const toolNames = [...inventory.tools];
    results.push({
      name: "Routing",
      status: "ok",
      message: `${skillNames.length} skills, ${mcpNames.length} MCPs, ${toolNames.length} tools discovered`,
    });
  } catch {
    results.push({ name: "Routing", status: "warn", message: "routing inventory discovery failed" });
  }

  return results;
}

// ── Memory ────────────────────────────────────────────────────

async function memoryChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const globalMemoryConfigPath = getGlobalMemoryConfigPath();
  const globalKimiDir = join(getUserHome(), ".kimi");
  const [globalMemoryConfigExists, memorySettings, globalKimiDirExists] = await Promise.all([
    pathExists(globalMemoryConfigPath),
    loadMemorySettings(process.cwd()),
    pathExists(globalKimiDir),
  ]);

  results.push({
    name: "Global Memory",
    status: globalMemoryConfigExists ? "ok" : "warn",
    message: globalMemoryConfigExists ? t("doctor.memorySynced") : t("doctor.memoryMissing"),
  });

  results.push({
    name: "Graph Memory",
    status: isGraphMemoryBackend(memorySettings.backend) ? "ok" : "info",
    message: isGraphMemoryBackend(memorySettings.backend)
      ? usesLocalGraphBackend(memorySettings.backend)
        ? `backend=local_graph, ontology=${memorySettings.localGraph.ontology}, state=${memorySettings.localGraph.path}`
        : usesKuzuBackend(memorySettings.backend)
          ? `backend=kuzu, path=${join(memorySettings.project.root, ".omk", "memory", "kuzu.db")}, project=${memorySettings.project.key}`
          : `backend=${memorySettings.backend}, project=${memorySettings.project.key}`
      : t("doctor.memoryFileBackend"),
  });

  let globalPollution = false;
  if (globalKimiDirExists) {
    try {
      const fs = await import("fs/promises");
      const entries = await fs.readdir(globalKimiDir, { withFileTypes: true });
      const unexpected = entries.filter((e) => e.isFile() && !isExpectedGlobalKimiFile(e.name)).map((e) => e.name);
      if (unexpected.length > 0) globalPollution = true;
    } catch { /* ignore */ }
  }
  results.push({
    name: "Global Pollution",
    status: globalPollution ? "warn" : "ok",
    message: globalPollution ? t("doctor.globalPollution") : t("doctor.globalClean"),
  });

  return results;
}

// ── Security ──────────────────────────────────────────────────

async function securityChecks(root: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const configPath = join(root, ".omk", "config.toml");
  const configExists = await pathExists(configPath);

  if (!configExists) {
    results.push({ name: "Config Audit", status: "info", message: ".omk/config.toml not found" });
    return results;
  }

  const config = await readTextFile(configPath, "");
  const warnings: string[] = [];

  if (/^\s*yolo_mode\s*=\s*true\b/m.test(config)) {
    warnings.push("yolo_mode=true");
  }

  const approvalMatch = config.match(/^approval_policy\s*=\s*"([^"]+)"/m);
  const approvalPolicy = approvalMatch?.[1]?.trim();
  if (approvalPolicy === "yolo") {
    warnings.push("approval_policy=yolo");
  }

  if (process.env.OMK_TRUST_ABSOLUTE_LOGO_PATH) {
    warnings.push("OMK_TRUST_ABSOLUTE_LOGO_PATH set");
  }

  if (/^\s*allow_write_config\s*=\s*true\b/m.test(config)) {
    warnings.push("allow_write_config=true");
  }

  if (warnings.length > 0) {
    results.push({
      name: "Dangerous Config",
      status: "warn",
      message: warnings.join(", ") + " — review security implications",
    });
  } else {
    results.push({
      name: "Dangerous Config",
      status: "ok",
      message: "no dangerous settings detected",
    });
  }

  return results;
}
