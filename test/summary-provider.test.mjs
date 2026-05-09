import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { summaryLatestCommand, summaryShowCommand } from "../dist/commands/summary.js";

async function createProviderRunProject() {
  const root = await mkdtemp(join(tmpdir(), "omk-summary-provider-"));
  const runId = "provider-summary-run";
  const runDir = join(root, ".omk", "runs", runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    join(runDir, "state.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        runId,
        startedAt: "2026-05-08T00:00:00.000Z",
        completedAt: "2026-05-08T00:00:03.000Z",
        nodes: [
          {
            id: "provider-review",
            name: "Provider review",
            role: "reviewer",
            dependsOn: [],
            status: "done",
            retries: 0,
            maxRetries: 1,
            durationMs: 1000,
            attempts: [
              {
                attempt: 1,
                startedAt: "2026-05-08T00:00:00.000Z",
                completedAt: "2026-05-08T00:00:01.000Z",
                durationMs: 1000,
                status: "done",
                provider: "kimi",
                requestedProvider: "deepseek",
                fallbackFrom: "deepseek",
                fallbackReason: "DeepSeek 402 insufficient balance",
              },
            ],
          },
          {
            id: "provider-plan",
            name: "Provider plan",
            role: "planner",
            dependsOn: [],
            status: "done",
            retries: 0,
            maxRetries: 1,
            durationMs: 2000,
            attempts: [
              {
                attempt: 1,
                startedAt: "2026-05-08T00:00:01.000Z",
                completedAt: "2026-05-08T00:00:03.000Z",
                durationMs: 2000,
                status: "done",
                provider: "openai",
                requestedProvider: "openai",
              },
            ],
          },
        ],
      },
      null,
      2
    )
  );
  return { root, runId, runDir };
}


async function writeRunState(root, runId, startedAt, completedAt = undefined) {
  const runDir = join(root, ".omk", "runs", runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    join(runDir, "state.json"),
    JSON.stringify({
      schemaVersion: 1,
      runId,
      startedAt,
      completedAt,
      nodes: [
        {
          id: "done",
          name: `Done ${runId}`,
          role: "tester",
          dependsOn: [],
          status: "done",
          retries: 0,
          maxRetries: 1,
        },
      ],
    }, null, 2)
  );
  return runDir;
}

async function withProjectRoot(root, fn) {
  const previousRoot = process.env.OMK_PROJECT_ROOT;
  const previousNoColor = process.env.NO_COLOR;
  process.env.OMK_PROJECT_ROOT = root;
  process.env.NO_COLOR = "1";
  try {
    return await fn();
  } finally {
    if (previousRoot === undefined) {
      delete process.env.OMK_PROJECT_ROOT;
    } else {
      process.env.OMK_PROJECT_ROOT = previousRoot;
    }
    if (previousNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = previousNoColor;
    }
  }
}

async function captureConsole(fn) {
  const originalLog = console.log;
  const output = [];
  console.log = (...args) => {
    output.push(args.join(" "));
  };
  try {
    await fn();
    return output.join("\n");
  } finally {
    console.log = originalLog;
  }
}

test("summary latest writes provider routing metrics to summary and report", async () => {
  const { root, runDir } = await createProviderRunProject();
  try {
    const output = await withProjectRoot(root, () => captureConsole(() => summaryLatestCommand()));
    const summary = await readFile(join(runDir, "summary.md"), "utf-8");
    const report = await readFile(join(runDir, "report.md"), "utf-8");

    assert.match(output, /Provider attempts/);
    assert.match(output, /Provider fallbacks/);
    assert.match(summary, /## Provider Routing/);
    assert.match(summary, /\\| Provider attempts \\| 2 \\|/);
    assert.match(summary, /\\| Provider fallbacks \\| 1 \\|/);
    assert.match(summary, /\\| kimi attempts \\| 1 \\|/);
    assert.match(summary, /\\| openai attempts \\| 1 \\|/);
    assert.match(summary, /DeepSeek 402 insufficient balance/);
    assert.match(report, /## Provider Routing/);
    assert.match(report, /Provider counts: kimi=1, openai=1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("summary show prints provider route and fallback totals", async () => {
  const { root, runId } = await createProviderRunProject();
  try {
    const output = await withProjectRoot(root, () => captureConsole(() => summaryShowCommand(runId)));

    assert.match(output, /Provider attempts/);
    assert.match(output, /2/);
    assert.match(output, /kimi=1, openai=1/);
    assert.match(output, /Provider fallbacks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("summary latest selects the newest run by state timestamp instead of lexicographic run id", async () => {
  const root = await mkdtemp(join(tmpdir(), "omk-summary-latest-"));
  try {
    const oldDir = await writeRunState(root, "zzz-old-manual", "2026-05-07T00:00:00.000Z", "2026-05-07T00:00:05.000Z");
    const newDir = await writeRunState(root, "aaa-new-iso", "2026-05-09T00:00:00.000Z", "2026-05-09T00:00:05.000Z");

    const output = await withProjectRoot(root, () => captureConsole(() => summaryLatestCommand()));

    assert.match(output, /Run ID.*aaa-new-iso/);
    assert.match(await readFile(join(newDir, "summary.md"), "utf-8"), /# Run Summary — aaa-new-iso/);
    await assert.rejects(readFile(join(oldDir, "summary.md"), "utf-8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
