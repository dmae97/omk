import { mkdir, writeFile, readFile, symlink } from "fs/promises";
import { dirname, join } from "path";
import { getProjectRoot, getUserHome, normalizeUserHomePath, pathExists } from "../../util/fs.js";
import { getOmkVersionSync } from "../../util/version.js";
import { style, header, status } from "../../util/theme.js";
import { defaultLspConfigJson } from "../../lsp/default-config.js";
import { t } from "../../util/i18n.js";
import { OMK_CORE_VERIFIED_PRESET } from "../../runtime/core-verified-preset.js";
import { packageRoot } from "./constants.js";
import {
  OKABE_AGENT_YAML,
  ROOT_AGENT_YAML,
  ROLE_YAMLS,
  ROOT_PROMPT_MD,
  HOOK_SCRIPTS,
  KIMI_CONFIG_TOML,
  MEMORY_FILES,
  getDesignMd,
  GEMINI_MD,
  CLAUDE_MD,
  ROADMAP_MD,
  SECURITY_MD,
} from "./content.js";
import { readTemplateFile } from "./utils.js";
import { copyTemplateDir, copySafeSkillRoot, createMcpJson, ensureProjectMcpConfig, checkOmkInPath, maybeInstallShellCompletion } from "./scaffold.js";
import { createThemeJson, createRuntimePresetsJson, getConfigToml } from "./config.js";
import {
  resolveLocalUserRuntime,
  runInitInteractiveSetup,
  shouldImportUserSkills,
} from "./interactive.js";
import type { InitCommandOptions } from "./types.js";

export async function initCommand(options: InitCommandOptions): Promise<void> {
  const root = getProjectRoot();
  const initHomeDir = normalizeUserHomePath(options.homeDir) ?? getUserHome(options.env ?? process.env);
  const mcpJson = createMcpJson(root);
  console.log(header(`open-multi-agent-kit init (profile: ${options.profile})`));
  const localUserRuntime = await resolveLocalUserRuntime(options, initHomeDir);

  // 1. Create directories (parallel)
  const dirs = [
    ".omk/memory",
    ".omk/runs",
    ".omk/checkpoints",
    ".omk/agents/roles",
    ".omk/prompts/role-addons",
    ".omk/hooks",
    ".omk/worktrees",
    ".omk/logs",
    ".omk/snippets",
    ".kimi/skills",
    ".kimi/hooks",
    ".agents/skills",
  ];
  await Promise.all(dirs.map((d) => mkdir(join(root, d), { recursive: true })));

  // 2. Write AGENTS.md (skip if exists)
  const agentsMdPath = join(root, "AGENTS.md");
  if (await pathExists(agentsMdPath)) {
    console.log(t("init.agentsMdExists"));
  } else {
    const agentsMdContent = await readFile(join(packageRoot, "templates", "AGENTS.md"), "utf8");
    await writeFile(agentsMdPath, agentsMdContent);
  }

  // 2.5 Write .kimi/AGENTS.md (Kimi-specific rules)
  const kimiAgentsMdPath = join(root, ".kimi", "AGENTS.md");
  if (await pathExists(kimiAgentsMdPath)) {
    console.log(t("init.kimiAgentsMdExists"));
  } else {
    const kimiAgentsMdContent = await readFile(join(packageRoot, "templates", ".kimi", "AGENTS.md"), "utf8");
    await writeFile(kimiAgentsMdPath, kimiAgentsMdContent);
  }

  // 3. Write / migrate agents (parallel)
  const okabeYamlPath = join(root, ".omk/agents/okabe.yaml");
  await writeFile(okabeYamlPath, OKABE_AGENT_YAML);

  const rootYamlPath = join(root, ".omk/agents/root.yaml");
  if (await pathExists(rootYamlPath)) {
    // Existing root.yaml migration: fix relative path bug
    const existing = await readFile(rootYamlPath, "utf8");
    if (existing.includes("system_prompt_path: ./prompts/root.md")) {
      const migrated = existing.replace(
        /system_prompt_path:\s*\.\/prompts\/root\.md/,
        "system_prompt_path: ../prompts/root.md"
      );
      await writeFile(rootYamlPath, migrated);
      console.log(status.ok(t("init.rootYamlMigrated")));
    }
  } else {
    const rootAgentYaml = await readTemplateFile(join(".omk", "agents", "root.yaml"), ROOT_AGENT_YAML);
    await writeFile(rootYamlPath, rootAgentYaml);
  }
  await Promise.all(
    Object.entries(ROLE_YAMLS).map(async ([name, content]) => {
      const roleYaml = await readTemplateFile(join(".omk", "agents", "roles", `${name}.yaml`), content);
      await writeFile(join(root, ".omk/agents/roles", `${name}.yaml`), roleYaml);
    })
  );

  // 4. Write prompts
  const rootPromptMd = await readTemplateFile(join(".omk", "prompts", "root.md"), ROOT_PROMPT_MD);
  await writeFile(join(root, ".omk/prompts/root.md"), rootPromptMd);

  // 5+6. Copy package skill templates by default.
  // Fresh open-source init should reference only the maintainer-packaged OMK
  // skills. Local maintainers can explicitly opt into importing personal skills
  // with --import-user-skills or OMK_INIT_IMPORT_USER_SKILLS=1.
  const kimiSkillsSrc = join(packageRoot, "templates", "skills", "kimi");
  const agentsSkillsSrc = join(packageRoot, "templates", "skills", "agents");
  const skillCopies: Promise<void>[] = [];
  const importUserSkills = shouldImportUserSkills(options);

  if (importUserSkills) {
    const personalSkillSources = [
      {
        label: "~/.kimi/skills",
        src: join(initHomeDir, ".kimi", "skills"),
        dest: join(root, ".kimi", "skills"),
      },
      {
        label: "~/.codex/skills",
        src: join(initHomeDir, ".codex", "skills"),
        dest: join(root, ".kimi", "skills"),
      },
      {
        label: "~/.agents/skills",
        src: join(initHomeDir, ".agents", "skills"),
        dest: join(root, ".agents", "skills"),
      },
    ];

    for (const source of personalSkillSources) {
      if (await pathExists(source.src)) {
        console.log(style.purple(`   📦 Importing ${source.label} (trusted local opt-in)...`));
        skillCopies.push(
          copySafeSkillRoot(source.src, source.dest).then((stats) => {
            if (stats.skippedUnsafe > 0) {
              console.log(status.warn(`Skipped ${stats.skippedUnsafe} secret-bearing skills from ${source.label}`));
            }
            if (stats.skippedUnavailable > 0) {
              console.log(status.warn(`Skipped ${stats.skippedUnavailable} unavailable skills from ${source.label}`));
            }
          })
        );
      }
    }
  }

  // Global skills symlink for local-user init
  let globalSkillsSymlinked = false;
  if (localUserRuntime && initHomeDir) {
    const globalKimiSkills = join(initHomeDir, ".kimi", "skills");
    if (await pathExists(globalKimiSkills)) {
      const dest = join(root, ".kimi", "skills");
      if (!(await pathExists(dest))) {
        console.log(style.purple("   📦 Symlinking global ~/.kimi/skills..."));
        await mkdir(dirname(dest), { recursive: true });
        try {
          await symlink(globalKimiSkills, dest, "dir");
          globalSkillsSymlinked = true;
        } catch (err) {
          console.warn(status.warn(`Failed to symlink global skills: ${(err as Error).message}`));
        }
      }
    }
  }

  if (!globalSkillsSymlinked && await pathExists(kimiSkillsSrc)) {
    console.log(style.purple(t("init.copyKimiSkills")));
    skillCopies.push(copySafeSkillRoot(kimiSkillsSrc, join(root, ".kimi", "skills")).then(() => undefined));
  } else if (!globalSkillsSymlinked) {
    console.log(status.warn(t("init.kimiSkillsMissing")));
  }
  if (await pathExists(agentsSkillsSrc)) {
    console.log(style.purple(t("init.copyPortableSkills")));
    skillCopies.push(copySafeSkillRoot(agentsSkillsSrc, join(root, ".agents", "skills")).then(() => undefined));
  } else {
    console.log(status.warn(t("init.portableSkillsMissing")));
  }
  if (skillCopies.length > 0) await Promise.all(skillCopies);

  // 7. Write hooks (parallel)
  await Promise.all(
    Object.entries(HOOK_SCRIPTS).map(async ([name, content]) => {
      const hookPath = join(root, ".omk/hooks", name);
      await writeFile(hookPath, content, { mode: 0o755 });
    })
  );

  // 8. Write configs
  const runtimeScope: import("./types.js").RuntimeScope = localUserRuntime ? "all" : "project";
  let configTomlContent = getConfigToml({
    mcpScope: runtimeScope,
    skillsScope: runtimeScope,
    hooksScope: runtimeScope,
  });
  if (localUserRuntime && initHomeDir) {
    const globalConfigPath = join(initHomeDir, ".omk", "config.toml");
    const globalConfig = await readFile(globalConfigPath, "utf-8").catch(() => null);
    if (globalConfig) {
      configTomlContent = globalConfig
        .replace(/^mcp_scope\s*=.*$/gm, `mcp_scope = "${runtimeScope}"`)
        .replace(/^skills_scope\s*=.*$/gm, `skills_scope = "${runtimeScope}"`)
        .replace(/^hooks_scope\s*=.*$/gm, `hooks_scope = "${runtimeScope}"`);
      console.log(style.purple("   📦 Inheriting global .omk/config.toml defaults..."));
    }
  }
  await writeFile(join(root, ".omk/config.toml"), configTomlContent);
  let kimiConfigContent = KIMI_CONFIG_TOML;
  if (localUserRuntime && initHomeDir) {
    const globalKimiConfigPath = join(initHomeDir, ".kimi", "config.toml");
    const globalKimiConfig = await readFile(globalKimiConfigPath, "utf-8").catch(() => null);
    if (globalKimiConfig) {
      kimiConfigContent = globalKimiConfig;
      console.log(style.purple("   📦 Inheriting global ~/.kimi/config.toml..."));
    }
  }
  await writeFile(join(root, ".omk/kimi.config.toml"), kimiConfigContent);
  await ensureProjectMcpConfig(join(root, ".omk/mcp.json"), mcpJson, { removeRuntimeManagedOmkProject: true });
  await writeFile(join(root, ".omk/theme.json"), createThemeJson());
  await writeFile(join(root, ".omk/runtime-preset.json"), JSON.stringify(OMK_CORE_VERIFIED_PRESET, null, 2) + "\n");
  await writeFile(join(root, ".omk/runtime-presets.json"), createRuntimePresetsJson());

  // Project-local server config must not import global definitions by default.
  const projectMcpPath = join(root, ".kimi", "mcp.json");
  const globalMcpPath = join(initHomeDir, ".kimi", "mcp.json");
  const hasGlobalMcp = localUserRuntime && initHomeDir && await pathExists(globalMcpPath);
  const { DEFAULT_PROJECT_MCP_COMMENT } = await import("./constants.js");
  const mcpComment = hasGlobalMcp
    ? "Project-local server config. Global entries are inherited from ~/.kimi/mcp.json at runtime when scope = 'all'."
    : DEFAULT_PROJECT_MCP_COMMENT;
  await ensureProjectMcpConfig(
    projectMcpPath,
    { _comment: mcpComment, mcpServers: {} },
    { removeRuntimeManagedOmkProject: true }
  );
  await writeFile(join(root, ".omk/lsp.json"), defaultLspConfigJson());

  // 9. Write memory files (parallel)
  await Promise.all(
    Object.entries(MEMORY_FILES).map(([name, content]) =>
      writeFile(join(root, ".omk/memory", name), content)
    )
  );

  // 9.5. Copy default snippet templates if they exist
  const snippetsSrc = join(packageRoot, "templates", "snippets");
  const snippetsDest = join(root, ".omk", "snippets");
  if (await pathExists(snippetsSrc)) {
    console.log(style.purple("   📦 Copying snippet templates..."));
    await copyTemplateDir(snippetsSrc, snippetsDest);
  }

  // 9.6. Copy spec-kit OMK preset template
  const presetSrc = join(packageRoot, "templates", "spec-kit-omk-preset");
  const presetDest = join(root, ".omk", "templates", "spec-kit-omk-preset");
  if (await pathExists(presetSrc)) {
    console.log(style.purple("   📦 Copying spec-kit OMK preset..."));
    await copyTemplateDir(presetSrc, presetDest);
  }

  // 10. Write project docs (skip if already exist)
  const docs: Record<string, string> = {
    "DESIGN.md": getDesignMd(getOmkVersionSync()),
    "GEMINI.md": GEMINI_MD,
    "CLAUDE.md": CLAUDE_MD,
    "ROADMAP.md": ROADMAP_MD,
    "SECURITY.md": SECURITY_MD,
  };
  for (const [name, content] of Object.entries(docs)) {
    const docPath = join(root, name);
    if (await pathExists(docPath)) {
      console.log(`   ℹ️ ${name} already exists — skipping`);
    } else {
      await writeFile(docPath, content);
    }
  }

  console.log(status.success("OMK initialized."));
  console.log();
  console.log("Created:");
  console.log("- AGENTS.md");
  console.log("- .kimi/AGENTS.md");
  console.log("- DESIGN.md");
  console.log("- .omk/agents/root.yaml");
  console.log("- .omk/agents/roles/");
  console.log("- .omk/prompts/root.md");
  console.log("- .omk/config.toml");
  console.log("- .omk/kimi.config.toml");
  console.log("- .omk/lsp.json");
  console.log("- .omk/hooks/");
  console.log("- .omk/snippets/");
  console.log("- .kimi/mcp.json");
  console.log("- .omk/mcp.json");
  console.log("- .omk/theme.json");
  console.log("- .omk/runtime-preset.json");
  console.log("- .omk/runtime-presets.json");
  console.log("- .kimi/skills/");
  console.log("- .agents/skills/");
  console.log("- .omk/memory/");
  console.log("- .omk/templates/spec-kit-omk-preset/");
  console.log();
  console.log("Default behavior:");
  console.log("- AGENTS.md is loaded into primary provider root prompt.");
  console.log("- Todo list is required for multi-step work.");
  console.log("- Subagents are required for non-trivial work.");
  console.log("- Project skills are auto-discovered from .kimi/skills and .agents/skills.");
  console.log("- Runtime presets include omk-core-verified, omk-ts-product, omk-worktree-team, and omk-release-guard.");
  if (localUserRuntime) {
    console.log("- Local user runtime enabled: global ~/.kimi/mcp.json and ~/.kimi/skills are used at runtime.");
    console.log("- Personal/global MCP servers and skills are not copied into the project.");
  } else {
    console.log("- omk-project is virtual runtime MCP injected; project MCP files are for user-added servers, remote/global MCPs are explicit opt-in.");
  }
  console.log("- Built-in tools: SearchWeb, FetchURL (no config required).");

  console.log(style.gray("  Fresh init does not copy user-global skills or MCP servers into the project."));
  console.log(style.gray("  Trusted local users can add --local-user --home-dir <~/.kimi/mcp.json> for runtime-only global MCP/skills, or --import-user-skills to copy reviewed personal skills."));

  await runInitInteractiveSetup(options, initHomeDir);

  // Warn about environment variable files — OMK prefers config.toml for stability
  for (const envFile of [".env", ".env.local", ".env.development"]) {
    if (await pathExists(join(root, envFile))) {
      console.log(style.orange(`⚠️  Found ${envFile}. OMK recommends using .omk/config.toml instead of environment variable files for stability.`));
      break;
    }
  }

  // ── Shell integration & PATH check ──
  const pathCheck = await checkOmkInPath();
  if (!pathCheck.inPath) {
    console.log("");
    console.log(style.orange("⚠️  omk is not in PATH."));
    console.log(style.gray("   Run one of the following:"));
    console.log(style.gray("   1) npm install -g @omk/cli"));
    console.log(style.gray("   2) npm link (for development)"));
    console.log(style.gray("   3) alias omk='npx -p @omk/cli omk'"));
  } else {
    await maybeInstallShellCompletion(root);
  }

  console.log("");
  console.log(style.purpleBold("   Next steps: ") + style.cream("omk doctor → omk chat"));
}
