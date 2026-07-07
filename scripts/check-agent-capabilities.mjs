// Regression guard: scan OMK agent .md files and flag skill/mcp/hook names not in the live catalog.
// Run: node scripts/check-agent-capabilities.mjs [--agent-dir <path>]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HOOKS = new Set([
  "awesome-agent-skills-router", "branch-diff-snapshot", "eslint-after-edit",
  "notify-sound-on-stop", "npm-audit-summary", "post-format", "post-init-mcp",
  "pre-shell-guard", "precompact-checkpoint", "protect-secrets",
  "release-check-before-stop", "session-context", "stop-verify",
  "subagent-stop-audit", "typecheck-after-edit", "worktree-create-guard",
]);
const MCPS = new Set([
  "adaptorch", "chrome-devtools", "context7", "fetch", "filesystem", "firecrawl",
  "github", "lean-ctx", "memory", "obsidian", "ouroboros", "playwright",
  "serena", "supermemory", "understand-anything", "zai-reader", "zai-vision", "zai-zread",
]);
const SKILL_ROOTS = [
  ".omk/agent/skills", ".omk/agent/omk-ui", ".omk/agent/plugins",
  ".omk/agent/packages", ".omk/agent/googleworkspace-cli", ".omk/agent/git",
  ".agents/skills",
].map((r) => path.join(os.homedir(), r));

function buildSkillSet() {
  const set = new Set();
  for (const root of SKILL_ROOTS) {
    let entries;
    try {
      entries = fs.readdirSync(root, { recursive: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const rel = typeof e === "string" ? e : e.name;
      if (path.basename(rel) !== "SKILL.md") continue;
      let name = path.basename(path.dirname(rel));
      try {
        const txt = fs.readFileSync(path.join(root, rel), "utf8");
        const fm = txt.match(/^---\s*\n([\s\S]*?)\n(?:---|\.\.\.)\s*(?:\n|$)/);
        if (fm) {
          const m = fm[1].match(/^name:\s*(.+?)\s*$/m);
          if (m) name = m[1].replace(/^['"]|['"]$/g, "").trim();
        }
      } catch {
        continue;
      }
      set.add(name.toLowerCase());
    }
  }
  return set;
}

// Extract cited names from one comma-separated value string. Drops sentinels
// ("none", "none specific", "No direct OMK skill match...") and prose fragments;
// only single kebab tokens survive, so multi-word prose never becomes a false hit.
function collect(value, kind, out) {
  const low = value.trim().toLowerCase();
  if (!low || low === "none" || low === "none specific" || low.startsWith("no direct omk skill match")) return;
  const stripped = value.replace(/\([^)]*\)/g, "");
  for (const raw of stripped.split(",")) {
    const c = raw.trim().replace(/^[.,;:\s]+|[\s.,;:]+$/g, "").trim();
    if (c && /^[a-z0-9][a-z0-9-]*$/.test(c.toLowerCase())) out.push({ kind, name: c });
  }
}

function parseAgent(text, out) {
  const fm = text.match(/^---\s*\n([\s\S]*?)\n(?:---|\.\.\.)\s*(?:\n|$)/);
  if (fm) {
    for (const [field, kind] of [["skills", "skill"], ["mcp", "mcp"], ["hooks", "hook"]]) {
      const m = fm[1].match(new RegExp("^" + field + ":\\s*(.+)$", "m"));
      if (m) collect(m[1], kind, out);
    }
  }
  for (const line of text.split("\n")) {
    let m;
    if ((m = line.match(/^- Skills:\s*(.*)$/))) collect(m[1], "skill", out);
    else if ((m = line.match(/^- Hooks relevant to this lane:\s*(.*)$/))) collect(m[1], "hook", out);
    else if ((m = line.match(/^- MCP to request from the root orchestrator:\s*(.*)$/))) collect(m[1], "mcp", out);
  }
}

function main() {
  const argv = process.argv.slice(2);
  let agentDir = process.env.OMK_AGENT_DIR || path.join(os.homedir(), ".omk", "agent", "agents");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent-dir" && i + 1 < argv.length) agentDir = argv[++i];
  }
  if (!fs.existsSync(agentDir) || !fs.statSync(agentDir).isDirectory()) {
    console.error(`Error: agent dir not found: ${agentDir}`);
    process.exit(1);
  }
  console.log(`Scanning agent dir: ${agentDir}`);
  const skills = buildSkillSet();
  const files = fs.readdirSync(agentDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("ua-"))
    .sort();
  let unknowns = 0;
  let filesWithUnknowns = 0;
  for (const f of files) {
    const out = [];
    try {
      parseAgent(fs.readFileSync(path.join(agentDir, f), "utf8"), out);
    } catch {
      continue;
    }
    const bad = [];
    for (const { kind, name } of out) {
      const known = kind === "skill" ? skills.has(name.toLowerCase())
        : kind === "hook" ? HOOKS.has(name) : MCPS.has(name);
      if (!known) bad.push(`${name} (${kind})`);
    }
    if (bad.length) {
      filesWithUnknowns++;
      unknowns += bad.length;
      for (const b of bad) console.log(`${f}: unknown skill/mcp/hook: ${b}`);
    }
  }
  console.log(`Scanned ${files.length} files, verified ${skills.size} skills on disk, ${unknowns} unknown names across ${filesWithUnknowns} files`);
  process.exit(unknowns > 0 ? 1 : 0);
}

main();
