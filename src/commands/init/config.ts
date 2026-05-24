import { OMK_PARALLEL_ORCHESTRATOR_PRESET, OMK_RUNTIME_PRESETS } from "../../runtime/core-verified-preset.js";
import type { RuntimeScope } from "./types.js";

export function createThemeJson(): string {
  return JSON.stringify({
    banner: {
      title: "open_multi-agent_kit",
      subtitle: "OMK — multi-provider agent orchestration CLI.",
      style: "default",
      enabled: true,
    },
    colors: {
      primary: "#7B5BF5",
      accent: "#EC4899",
      success: "#14B8A6",
      warning: "#FB923C",
      danger: "#F87171",
      info: "#60A5FA",
      muted: "#94A3B8",
    },
    metaBox: true,
  }, null, 2) + "\n";
}

export function createRuntimePresetsJson(): string {
  return JSON.stringify({
    defaultPresetId: OMK_PARALLEL_ORCHESTRATOR_PRESET.id,
    presets: OMK_RUNTIME_PRESETS,
  }, null, 2) + "\n";
}

export function getConfigToml(options: { mcpScope: RuntimeScope; skillsScope: RuntimeScope; hooksScope: RuntimeScope }): string {
  const { mcpScope, skillsScope, hooksScope } = options;
  return `# open_multi-agent_kit project settings
[project]
name = "my-project"
description = ""

[orchestration]
default_workers = 4
max_retries = 3
approval_policy = "auto"         # safe default: safe tools auto, destructive ask
execution_prompt = "ask"         # ask | auto | parallel | sequential
yolo_mode = false                # safe guards still block secrets/destructive shell hooks

[runtime]
# auto chooses lite on <=18GB RAM hosts to make 16GB laptops usable.
resource_profile = "auto"        # auto | lite | standard
mcp_scope = "${mcpScope}"            # all | project | none — all also reads user ~/.kimi/mcp.json at runtime
skills_scope = "${skillsScope}"         # all | project | none — all reads user ~/.kimi/skills without copying them
hooks_scope = "${hooksScope}"          # all | project | none — all reads user ~/.kimi hooks without copying them
max_workers = 4                  # can override with OMK_MAX_WORKERS
max_output_mb = 4                # cap buffered shell/quality output
wire_output_mb = 1               # cap per-task retained wire output

[ensemble]
# Role-aware agent ensemble. Keep max_parallel=1 for 16GB/WSL safety.
enabled = true
max_candidates_per_node = 2
max_parallel = 2
quorum_ratio = 0.5

[quality]
lint = "auto"      # auto | command
test = "auto"
typecheck = "auto"
build = "auto"

[memory]
# Project-local ontology graph is the default source of truth for project/session memory.
# Use backend = "kuzu" for the embedded Kuzu ontology graph backend.
backend = "local_graph"    # local_graph | kuzu
scope = "project-session"
strict = true               # fail memory writes if the selected graph backend is unavailable
mirror_files = true         # keep .omk/memory/*.md as readable mirrors
migrate_files = true        # seed the graph from existing .omk/memory files on first read

[local_graph]
path = ".omk/memory/graph-state.json"
ontology = "omk-ontology-mindmap-v1"
query = "graphql-lite"


[locale]
# UI language: en (default) | ko | ja
language = "en"

[theme]
# Optional custom logo image path for terminal welcome banner.
# omk init does not create or copy image assets; add your own asset first, then uncomment.
# Relative paths are resolved from project root; absolute paths require OMK_TRUST_ABSOLUTE_LOGO_PATH=1.
# Supported formats: PNG, JPEG, GIF, WEBP (high-res on iTerm/Konsole, else ANSI block).
# logo_image = "assets/omk-logo.png"

[router]
default_model = "kimi-k2.6"
research_thinking = "disabled"
coding_thinking = "enabled"
`;
}
