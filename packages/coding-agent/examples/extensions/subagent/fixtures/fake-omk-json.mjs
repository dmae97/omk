#!/usr/bin/env node
import { appendFileSync } from "node:fs";

// Spec 057: tests read the worker argv back from this file.
if (process.env.OMK_FAKE_ARGV_FILE) {
	appendFileSync(process.env.OMK_FAKE_ARGV_FILE, `${JSON.stringify(process.argv.slice(2))}\n`);
}

// Tests read the worker's run-log parent session back from this file.
if (process.env.OMK_FAKE_ENV_FILE) {
	appendFileSync(
		process.env.OMK_FAKE_ENV_FILE,
		`${JSON.stringify({ task: process.argv[process.argv.length - 1], parent: process.env.OMK_RUN_LOG_PARENT_SESSION ?? null })}\n`,
	);
}

const expectedModel = process.env.OMK_EXPECTED_MODEL;
if (expectedModel) {
	const modelIndex = process.argv.indexOf("--model");
	const actualModel = modelIndex === -1 ? undefined : process.argv[modelIndex + 1];
	if (actualModel !== expectedModel) {
		process.stderr.write(`expected --model ${expectedModel}, received ${actualModel ?? "none"}\n`);
		process.exit(2);
	}
}

process.stdout.write(
	`${JSON.stringify({
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "fixture subagent completed" }],
			provider: "fixture-provider",
			model: "fixture-model",
		},
	})}\n`,
);
