import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  getStarPromptSummary,
  isStarPromptEligible,
  maybeAskForGitHubStar,
  maybeAskForGitHubStarAfterCommand,
  maybeAskForGitHubStarAtChatStart,
  parseGitHubRepoSlug,
  readStarPromptState,
} from "../dist/util/first-run-star.js";
import { formatOmkVersionFooter, getOmkVersionSync, OMK_REPO_URL } from "../dist/util/version.js";

test("first-run star prompt is skipped for non-interactive or CI runs", () => {
  assert.equal(isStarPromptEligible({
    env: {},
    stdin: { isTTY: false },
    stdout: { isTTY: true },
    argv: ["node", "omk", "doctor"],
  }), false);

  assert.equal(isStarPromptEligible({
    env: { CI: "true" },
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    argv: ["node", "omk", "doctor"],
  }), false);
});

test("first-run star prompt is skipped for interactive chat entrypoints", () => {
  for (const commandName of ["omk", "chat"]) {
    assert.equal(isStarPromptEligible({
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", commandName === "omk" ? "" : commandName].filter(Boolean),
      commandName,
    }), false);
  }
});

test("first-run star prompt records YES and stars GitHub once", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-prompt-"));
  const starred = [];
  try {
    const result = await maybeAskForGitHubStar({
      version: "1.2.3",
      homeDir,
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", "doctor"],
      commandName: "doctor",
      prompt: async () => true,
      starRepo: async (url) => { starred.push(url); },
      now: () => new Date("2026-05-01T00:00:00.000Z"),
    });

    assert.equal(result, "yes");
    assert.deepEqual(starred, [OMK_REPO_URL]);
    assert.deepEqual(await readStarPromptState(homeDir), {
      promptedAt: "2026-05-01T00:00:00.000Z",
      answer: "yes",
      version: "1.2.3",
      repoUrl: OMK_REPO_URL,
      action: "github-star",
      starred: true,
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("first-run star prompt records star failure without opening a browser", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-prompt-fail-"));
  try {
    const result = await maybeAskForGitHubStar({
      version: "1.2.3",
      homeDir,
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", "doctor"],
      commandName: "doctor",
      prompt: async () => true,
      starRepo: async () => { throw new Error("gh auth missing"); },
      now: () => new Date("2026-05-01T00:00:00.000Z"),
    });

    assert.equal(result, "yes");
    assert.deepEqual(await readStarPromptState(homeDir), {
      promptedAt: "2026-05-01T00:00:00.000Z",
      answer: "yes",
      version: "1.2.3",
      repoUrl: OMK_REPO_URL,
      action: "github-star",
      starred: false,
      starError: "gh auth missing",
    });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("GitHub repo slug parser supports browser and git URLs", () => {
  assert.equal(parseGitHubRepoSlug("https://github.com/dmae97/open_multi-agent_kit"), "dmae97/open_multi-agent_kit");
  assert.equal(parseGitHubRepoSlug("git@github.com:dmae97/open_multi-agent_kit.git"), "dmae97/open_multi-agent_kit");
});

test("maybeAskForGitHubStarAfterCommand skips non-whitelist commands", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-after-cmd-"));
  try {
    for (const commandName of ["chat", "lsp", "--help"]) {
      const result = await maybeAskForGitHubStarAfterCommand({
        version: "1.2.3",
        homeDir,
        env: { OMK_STAR_PROMPT: "force" },
        stdin: { isTTY: true },
        stdout: { isTTY: true },
        argv: ["node", "omk", commandName],
        commandName,
        prompt: async () => true,
      });
      assert.equal(result, "skipped", `expected ${commandName} to be skipped`);
    }

    for (const commandName of ["doctor", "hud", "plan", "parallel", "run"]) {
      const result = await maybeAskForGitHubStarAfterCommand({
        version: "1.2.3",
        homeDir: await mkdtemp(join(tmpdir(), "omk-star-after-cmd-")),
        env: { OMK_STAR_PROMPT: "force" },
        stdin: { isTTY: true },
        stdout: { isTTY: true },
        argv: ["node", "omk", commandName],
        commandName,
        prompt: async () => true,
        starRepo: async () => {},
      });
      assert.equal(result, "yes", `expected ${commandName} to be eligible`);
    }

    // init should NOT trigger the prompt
    {
      const result = await maybeAskForGitHubStarAfterCommand({
        version: "1.2.3",
        homeDir: await mkdtemp(join(tmpdir(), "omk-star-after-cmd-")),
        env: { OMK_STAR_PROMPT: "force" },
        stdin: { isTTY: true },
        stdout: { isTTY: true },
        argv: ["node", "omk", "init"],
        commandName: "init",
        prompt: async () => true,
        starRepo: async () => {},
      });
      assert.equal(result, "skipped", "expected init to be skipped");
    }
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("maybeAskForGitHubStarAfterCommand records NO and never calls starRepo", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-after-no-"));
  const starred = [];
  try {
    const result = await maybeAskForGitHubStarAfterCommand({
      version: "1.2.3",
      homeDir,
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", "doctor"],
      commandName: "doctor",
      prompt: async () => false,
      starRepo: async (url) => { starred.push(url); },
      now: () => new Date("2026-05-01T00:00:00.000Z"),
    });

    assert.equal(result, "no");
    assert.deepEqual(starred, []);
    const state = await readStarPromptState(homeDir);
    assert.equal(state.answer, "no");
    assert.equal(state.starred, undefined);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("maybeAskForGitHubStarAfterCommand gh failure records starError but returns command success", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-after-err-"));
  try {
    const result = await maybeAskForGitHubStarAfterCommand({
      version: "1.2.3",
      homeDir,
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", "doctor"],
      commandName: "doctor",
      prompt: async () => true,
      starRepo: async () => { throw new Error("gh not found"); },
      now: () => new Date("2026-05-01T00:00:00.000Z"),
    });

    assert.equal(result, "yes");
    const state = await readStarPromptState(homeDir);
    assert.equal(state.starred, false);
    assert.equal(state.starError, "gh not found");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("unauthenticated gh skips star with error recorded", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-auth-err-"));
  try {
    const result = await maybeAskForGitHubStar({
      version: "1.2.3",
      homeDir,
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", "doctor"],
      commandName: "doctor",
      prompt: async () => true,
      starRepo: async () => { throw new Error("GitHub CLI not authenticated. Run `gh auth login` first."); },
      now: () => new Date("2026-05-01T00:00:00.000Z"),
    });

    assert.equal(result, "yes");
    const state = await readStarPromptState(homeDir);
    assert.equal(state.starred, false);
    assert.equal(state.starError, "GitHub CLI not authenticated. Run `gh auth login` first.");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("getStarPromptSummary returns null when no state", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-summary-null-"));
  try {
    const summary = await getStarPromptSummary(homeDir);
    assert.equal(summary, null);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("getStarPromptSummary returns summary when state exists", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-summary-ok-"));
  try {
    await maybeAskForGitHubStarAfterCommand({
      version: "1.2.3",
      homeDir,
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", "doctor"],
      commandName: "doctor",
      prompt: async () => true,
      starRepo: async () => {},
    });

    const summary = await getStarPromptSummary(homeDir);
    assert.deepEqual(summary, { answered: true, starred: true, starError: undefined });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("state file privacy assertion", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-privacy-"));
  try {
    await maybeAskForGitHubStarAfterCommand({
      version: "1.2.3",
      homeDir,
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", "doctor"],
      commandName: "doctor",
      prompt: async () => true,
      starRepo: async () => {},
    });

    const raw = await readFile(join(homeDir, ".omk", "star-prompt.json"), "utf-8");
    const parsed = JSON.parse(raw);
    for (const key of ["token", "password", "secret", "auth"]) {
      assert.equal(parsed[key], undefined, `state file must not contain ${key}`);
    }
    assert.equal(raw.includes("ghp_"), false, "state file must not contain ghp_ token");
    assert.equal(raw.includes("github_pat"), false, "state file must not contain github_pat token");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("OMK version footer reads package version", () => {
  assert.match(getOmkVersionSync(), /^\d+\.\d+\.\d+/);
  assert.match(formatOmkVersionFooter(), /omk v\d+\.\d+\.\d+/);
  assert.match(formatOmkVersionFooter(), /github\.com\/dmae97\/open_multi-agent_kit/);
});

test("maybeAskForGitHubStarAtChatStart skips cockpit child", async () => {
  const result = await maybeAskForGitHubStarAtChatStart({
    version: "1.2.3",
    env: { OMK_CHAT_COCKPIT_CHILD: "1", OMK_STAR_PROMPT: "force" },
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    argv: ["node", "omk", "chat"],
    commandName: "chat",
    prompt: async () => true,
  });
  assert.equal(result, "skipped");
});

test("maybeAskForGitHubStarAtChatStart allows chat when TTY and no prior state", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-chat-start-"));
  const starred = [];
  try {
    const result = await maybeAskForGitHubStarAtChatStart({
      version: "1.2.3",
      homeDir,
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", "chat"],
      commandName: "chat",
      prompt: async () => true,
      starRepo: async (url) => { starred.push(url); },
      now: () => new Date("2026-05-01T00:00:00.000Z"),
    });
    assert.equal(result, "yes");
    assert.deepEqual(starred, [OMK_REPO_URL]);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("maybeAskForGitHubStarAtChatStart returns seen when prior state exists", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "omk-star-chat-seen-"));
  try {
    await maybeAskForGitHubStarAtChatStart({
      version: "1.2.3",
      homeDir,
      env: { OMK_STAR_PROMPT: "force" },
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", "chat"],
      commandName: "chat",
      prompt: async () => false,
      now: () => new Date("2026-05-01T00:00:00.000Z"),
    });

    const result = await maybeAskForGitHubStarAtChatStart({
      version: "1.2.3",
      homeDir,
      env: {},
      stdin: { isTTY: true },
      stdout: { isTTY: true },
      argv: ["node", "omk", "chat"],
      commandName: "chat",
      prompt: async () => true,
    });
    assert.equal(result, "seen");
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
