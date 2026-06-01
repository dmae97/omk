#!/usr/bin/env node
import { readFileSync } from "node:fs";

const tokenPattern = /\b(?:kimi|KIMI|moonshot|Kimi\s+CLI|Kimi\s+HUD|kimi-cli|kimi-print|kimi-wire|kimi-api|kimi-native)\b/i;

const strictDefaultSurfaceFiles = [
  "src/runtime/runtime-router.ts",
  "src/runtime/debloat-nlp.ts",
  "src/providers/provider-router.ts",
  "src/providers/provider-stats.ts",
  "src/cli/v2/chat-repl.ts",
  "src/cli/v2/interactive-prompt.ts",
  "src/cli/v2/cli-v2-skeleton.ts",
  "src/cli/root.ts",
  "src/hud/render.ts",
  "src/commands/hud.ts",
];

const violations = [];

for (const file of strictDefaultSurfaceFiles) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (tokenPattern.test(line)) {
      violations.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  }
}

const legacyIsolationChecks = [
  {
    file: "src/runtime/runtime-backed-task-runner.ts",
    checks: [
      {
        name: "provider keys prefer OMK config",
        pattern: /readProviderConfig\("\.omk"\)/,
      },
      {
        name: "legacy home config is gated",
        pattern: /options\.legacyKimiEnabled\s*\?\s*\[readProviderConfig\("\.kimi"\)\]\s*:\s*\[\]/,
      },
      {
        name: "legacy runtime registration is explicit",
        pattern: /legacyKimiEnabled\s*&&\s*await checkCommand/,
      },
    ],
  },
  {
    file: "src/providers/provider-runtime.ts",
    checks: [
      {
        name: "legacy request is explicit",
        pattern: /const legacyKimiRequested = shouldEnableLegacyKimi\(providerPolicy, options\.fallbackChain\)/,
      },
      {
        name: "legacy provider registration is gated",
        pattern: /if \(legacyKimiRequested\) \{[\s\S]*createKimiProvider/,
      },
      {
        name: "legacy CLI runtime registration is gated",
        pattern: /if \(legacyKimiRequested\) \{[\s\S]*await checkCommand/,
      },
    ],
  },
];

for (const { file, checks } of legacyIsolationChecks) {
  const text = readFileSync(file, "utf8");
  for (const { name, pattern } of checks) {
    if (!pattern.test(text)) {
      violations.push(`${file}: missing legacy-isolation guard: ${name}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Default control-plane surface contains legacy KIMI tokens:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  `Default control-plane surface is provider-neutral (${strictDefaultSurfaceFiles.length} files checked; ${legacyIsolationChecks.length} legacy guards checked).`
);
