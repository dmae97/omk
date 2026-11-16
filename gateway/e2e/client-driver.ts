/**
 * T-13 client-side cases. Run from the PR #387 merge worktree so `omk-ai` resolves.
 * Writes a JSON report to $T13_REPORT_PATH. Never prints the account token.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { streamSimple, Type, type AssistantMessage, type Context, type Model, type Tool } from "omk-ai";
import { AuthStorage } from "/workspace/omk-t13-client/packages/coding-agent/src/core/auth-storage.ts";
import { ModelRegistry } from "/workspace/omk-t13-client/packages/coding-agent/src/core/model-registry.ts";
import { registerOmkProviderIfEnabled } from "/workspace/omk-t13-client/packages/coding-agent/src/core/omk-provider/register.ts";
import { redact, redactJson } from "./redact.ts";

const GATEWAY = (process.env.OMK_GATEWAY_BASE_URL ?? "http://127.0.0.1:8787/v1").replace(/\/+$/, "");
const TOKEN = process.env.OMK_ACCOUNT_TOKEN ?? "";
const CLIENT_ROOT = process.env.T13_CLIENT_ROOT ?? "/workspace/omk-t13-client";
const CLI = process.env.T13_CLI ?? join(CLIENT_ROOT, "packages/coding-agent/dist/cli.js");
const REPORT_PATH = process.env.T13_REPORT_PATH ?? join(tmpdir(), "t13-report.json");
const CASE_TIMEOUT_MS = Number(process.env.T13_CASE_TIMEOUT_MS ?? 90_000);

type CaseResult = {
	id: string;
	title: string;
	pass: boolean;
	evidence: Record<string, unknown>;
	error?: string;
	clientBugs?: string[];
	notes?: string[];
};

const cases: CaseResult[] = [];

function header(caseId: string): Record<string, string> {
	return { "x-t13-case": caseId };
}

async function collectStream(
	model: Model<any>,
	context: Context,
	options: Record<string, unknown>,
): Promise<{ message: AssistantMessage; thinking: string; text: string; toolCalls: { id: string; name: string; arguments: unknown }[]; events: string[] }> {
	const events: string[] = [];
	let thinking = "";
	let text = "";
	const toolCalls: { id: string; name: string; arguments: unknown }[] = [];
	const stream = streamSimple(model, context, options);
	for await (const ev of stream) {
		events.push(ev.type);
		if (ev.type === "thinking_delta") thinking += ev.delta;
		if (ev.type === "thinking_end") thinking = ev.content || thinking;
		if (ev.type === "text_delta") text += ev.delta;
		if (ev.type === "text_end") text = ev.content || text;
		if (ev.type === "toolcall_end") {
			toolCalls.push({ id: ev.toolCall.id, name: ev.toolCall.name, arguments: ev.toolCall.arguments });
		}
	}
	const message = await stream.result();
	if (!text) {
		const block = message.content?.find((b: any) => b.type === "text");
		if (block && "text" in block) text = String(block.text ?? "");
	}
	if (!thinking) {
		const block = message.content?.find((b: any) => b.type === "thinking");
		if (block && "thinking" in block) thinking = String(block.thinking ?? "");
	}
	if (toolCalls.length === 0) {
		for (const b of message.content ?? []) {
			if ((b as any).type === "toolCall") {
				toolCalls.push({ id: (b as any).id, name: (b as any).name, arguments: (b as any).arguments });
			}
		}
	}
	return { message, thinking, text, toolCalls, events };
}

function cliTermination(stdout: string, stderr: string): unknown {
	for (const line of `${stdout}\n${stderr}`.split("\n")) {
		const t = line.trim();
		if (!t.startsWith("{")) continue;
		try {
			const ev = JSON.parse(t);
			if (ev?.type === "session_termination" || ev?.termination) return ev;
		} catch {
			/* ignore */
		}
	}
	return null;
}

function runCli(args: string[], env: NodeJS.ProcessEnv, timeoutMs = CASE_TIMEOUT_MS): Promise<{
	stdout: string;
	stderr: string;
	code: number | null;
	termination: unknown;
	node: string;
}> {
	const home = mkdtempSync(join(tmpdir(), "omk-t13-home-"));
	const nodeBin = process.env.T13_NODE || process.execPath;
	const childEnv: NodeJS.ProcessEnv = {
		PATH: process.env.PATH,
		HOME: home,
		OMK_CODING_AGENT_DIR: join(home, "agent"),
		OMK_PROVIDER_OMK: "1",
		OMK_GATEWAY_BASE_URL: GATEWAY,
		OMK_OFFLINE: "1",
		OMK_SKIP_VERSION_CHECK: "1",
		OMK_TRUST_PROJECT: "1",
		NO_COLOR: "1",
		...env,
	};
	if (!("OMK_ACCOUNT_TOKEN" in env) && TOKEN) childEnv.OMK_ACCOUNT_TOKEN = TOKEN;
	return new Promise((resolve, reject) => {
		const child = spawn(nodeBin, [CLI, ...args], {
			cwd: home,
			env: childEnv,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (c) => {
			stdout += c;
		});
		child.stderr.on("data", (c) => {
			stderr += c;
		});
		const t = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`CLI timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		child.on("error", (err) => {
			clearTimeout(t);
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(t);
			const out = redact(stdout);
			const err = redact(stderr);
			resolve({ stdout: out, stderr: err, code, termination: cliTermination(out, err), node: nodeBin });
		});
	});
}

function extractJsonEvents(stdout: string): any[] {
	const evs: any[] = [];
	for (const line of stdout.split("\n")) {
		const s = line.trim();
		if (!s.startsWith("{")) continue;
		try {
			evs.push(JSON.parse(s));
		} catch {
			/* ignore non-json */
		}
	}
	return evs;
}

function clip(s: string, n = 800): string {
	const t = redact(s);
	return t.length > n ? `${t.slice(0, n)}…` : t;
}

async function runCase(id: string, title: string, fn: () => Promise<Partial<CaseResult>>): Promise<void> {
	const started = Date.now();
	try {
		const extra = await fn();
		const pass = extra.pass !== false;
		cases.push({
			id,
			title,
			pass,
			evidence: { ms: Date.now() - started, ...(extra.evidence ?? {}) },
			error: extra.error,
			clientBugs: extra.clientBugs,
			notes: extra.notes,
		});
		console.error(redact(`[T-13] ${id} ${pass ? "PASS" : "FAIL"} — ${title}`));
	} catch (e) {
		cases.push({
			id,
			title,
			pass: false,
			evidence: { ms: Date.now() - started },
			error: redact(e instanceof Error ? `${e.name}: ${e.message}` : String(e)),
		});
		console.error(redact(`[T-13] ${id} FAIL — ${title}: ${e instanceof Error ? e.message : e}`));
	}
}

process.env.OMK_PROVIDER_OMK = "1";
process.env.OMK_GATEWAY_BASE_URL = GATEWAY;

const registry = ModelRegistry.create(AuthStorage.inMemory(), join(tmpdir(), `t13-models-${process.pid}.json`));
const diagnostics = registerOmkProviderIfEnabled(registry, process.env);
if (diagnostics.length) {
	console.error(redact(`registration diagnostics: ${JSON.stringify(diagnostics)}`));
}
const coder = registry.find("OMK", "coder");
const reasoner = registry.find("OMK", "reasoner");
if (!coder || !reasoner) {
	throw new Error(`OMK models not registered (coder=${!!coder} reasoner=${!!reasoner})`);
}

const weatherTool: Tool = {
	name: "get_weather",
	description: "Get current weather for a city",
	parameters: Type.Object({
		city: Type.String({ description: "City name" }),
	}),
};

await runCase("1a", "OMK/coder non-stream (raw HTTP; client has no non-stream path)", async () => {
	const res = await fetch(`${GATEWAY}/chat/completions`, {
		method: "POST",
		headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...header("1a") },
		body: JSON.stringify({ model: "OMK/coder", messages: [{ role: "user", content: "hi from t13 non-stream" }] }),
	});
	const json = await res.json();
	const content = json?.choices?.[0]?.message?.content;
	const pass = res.ok && content === "mock reply" && json?.object === "chat.completion";
	return {
		pass,
		evidence: {
			httpStatus: res.status,
			content,
			object: json?.object,
			finish: json?.choices?.[0]?.finish_reason,
			hasUsage: Boolean(json?.usage),
		},
		notes: [
			"The official client streamSimple/completeSimple path always sets stream:true (packages/ai/src/providers/openai-completions.ts:517). This case hits the gateway non-stream JSON mode with the same token, base URL, and model id the client uses.",
		],
	};
});

await runCase("1b", "OMK/coder streamed turn via streamSimple", async () => {
	const { message, text, thinking, events } = await collectStream(
		coder,
		{ messages: [{ role: "user", content: "hi from t13 coder stream", timestamp: Date.now() }] },
		{ apiKey: TOKEN, maxTokens: 256, headers: header("1b") },
	);
	const pass = text.includes("mock reply") && !thinking && message.stopReason !== "error";
	return {
		pass,
		evidence: {
			text,
			thinking: thinking || null,
			stopReason: message.stopReason,
			errorMessage: message.errorMessage ? redact(message.errorMessage) : null,
			events,
		},
	};
});

await runCase("1c", "OMK/coder streamed turn via CLI print/json mode", async () => {
	const cli = await runCli(
		["--mode", "json", "-p", "--no-session", "--no-extensions", "--no-tools", "--model", "OMK/coder", "Say hi in one word."],
		{},
	);
	const evs = extractJsonEvents(cli.stdout);
	const blob = `${cli.stdout}\n${cli.stderr}`;
	const sawText = blob.includes("mock reply");
	const pass = sawText && cli.code === 0;
	return {
		pass,
		evidence: {
			exitCode: cli.code,
			node: cli.node,
			sawText,
			termination: cli.termination,
			eventTypes: evs.map((e) => e.type).filter(Boolean).slice(0, 40),
			stdoutClip: clip(cli.stdout, 1200),
			stderrClip: clip(cli.stderr, 800),
		},
		notes: cli.code !== 0 && !sawText ? ["CLI did not complete successfully; streamSimple case 1b is the backup client path."] : undefined,
	};
});

await runCase("2", "OMK/reasoner streamed turn with reasoning shown", async () => {
	const { message, text, thinking, events } = await collectStream(
		reasoner,
		{ messages: [{ role: "user", content: "hi from t13 reasoner stream", timestamp: Date.now() }] },
		{ apiKey: TOKEN, maxTokens: 256, reasoning: "low", headers: header("2") },
	);
	const cli = await runCli(
		["--mode", "json", "-p", "--no-session", "--no-extensions", "--no-tools", "--model", "OMK/reasoner:low", "Think briefly, then say hi."],
		{},
	);
	const cliBlob = `${cli.stdout}\n${cli.stderr}`;
	const streamPass = thinking.includes("Let me think step by step.") && text.includes("mock reply") && message.stopReason !== "error";
	const cliPass = cliBlob.includes("Let me think step by step.") && cliBlob.includes("mock reply") && cli.code === 0;
	return {
		pass: streamPass && cliPass,
		evidence: {
			streamSimple: { text, thinking, stopReason: message.stopReason, events, errorMessage: message.errorMessage ? redact(message.errorMessage) : null },
			cli: {
				exitCode: cli.code,
				node: cli.node,
				sawReasoning: cliBlob.includes("Let me think step by step."),
				sawText: cliBlob.includes("mock reply"),
				termination: cli.termination,
				eventTypes: extractJsonEvents(cli.stdout).map((e) => e.type).filter(Boolean).slice(0, 40),
				stdoutClip: clip(cli.stdout, 1200),
				stderrClip: clip(cli.stderr, 800),
			},
		},
		notes: !cliPass && streamPass ? ["CLI path failed or did not surface reasoning; streamSimple still showed reasoning_content as thinking."] : undefined,
	};
});

await runCase("3", "Tool-call loop via streamSimple (get_weather -> final answer)", async () => {
	const context: Context = {
		messages: [{ role: "user", content: "What is the weather in Seoul?", timestamp: Date.now() }],
		tools: [weatherTool],
	};
	const first = await collectStream(coder, context, { apiKey: TOKEN, maxTokens: 256, headers: header("3a") });
	const call = first.toolCalls[0];
	const firstOk =
		first.message.stopReason === "toolUse" &&
		call?.name === "get_weather" &&
		call?.id === "call_1" &&
		(call?.arguments as any)?.city === "Seoul";
	if (!firstOk) {
		return {
			pass: false,
			evidence: {
				first: {
					stopReason: first.message.stopReason,
					errorMessage: first.message.errorMessage ? redact(first.message.errorMessage) : null,
					text: first.text,
					toolCalls: first.toolCalls,
					events: first.events,
				},
			},
		};
	}
	context.messages.push(first.message);
	context.messages.push({
		role: "toolResult",
		toolCallId: call.id,
		toolName: call.name,
		content: [{ type: "text", text: "18C clear" }],
		isError: false,
		timestamp: Date.now(),
	});
	const second = await collectStream(coder, context, { apiKey: TOKEN, maxTokens: 256, headers: header("3b") });
	const secondOk = second.text.includes("It's 18C and clear in Seoul.") && second.message.stopReason !== "error" && second.toolCalls.length === 0;
	return {
		pass: Boolean(firstOk && secondOk),
		evidence: {
			first: { stopReason: first.message.stopReason, toolCalls: first.toolCalls, events: first.events },
			second: {
				stopReason: second.message.stopReason,
				text: second.text,
				thinking: second.thinking || null,
				events: second.events,
				errorMessage: second.message.errorMessage ? redact(second.message.errorMessage) : null,
			},
		},
		notes: [
			"CLI --tools only filters built-in tools; it cannot inject a custom get_weather tool. This loop drives the provider stream function directly, as allowed by T-13.",
		],
	};
});

await runCase("4a", "Internal call (no reasoning key) on reasoner goes to coder, no thinking_required", async () => {
	let payload: Record<string, unknown> | undefined;
	const { message, text } = await collectStream(
		reasoner,
		{ messages: [{ role: "user", content: "internal summary please", timestamp: Date.now() }] },
		{
			apiKey: TOKEN,
			maxTokens: 256,
			headers: header("4a"),
			onPayload: (body: unknown) => {
				payload = body as Record<string, unknown>;
				return body;
			},
		},
	);
	const noThinking = payload && !("thinking" in payload) && !("reasoning_effort" in payload);
	const modelIsCoder = payload?.model === "coder";
	const noError = message.stopReason !== "error" && !String(message.errorMessage ?? "").includes("thinking_required");
	return {
		pass: Boolean(modelIsCoder && noThinking && noError && text.includes("mock reply")),
		evidence: {
			wireModel: payload?.model,
			thinking: payload?.thinking ?? null,
			reasoning_effort: payload?.reasoning_effort ?? null,
			stopReason: message.stopReason,
			text,
			errorMessage: message.errorMessage ? redact(message.errorMessage) : null,
		},
	};
});

await runCase("4b", "Deliberate thinking-off request to reasoner yields 400 thinking_required, surfaced by the client", async () => {
	let payload: Record<string, unknown> | undefined;
	const { message } = await collectStream(
		reasoner,
		{ messages: [{ role: "user", content: "force thinking off", timestamp: Date.now() }] },
		{
			apiKey: TOKEN,
			maxTokens: 256,
			reasoning: "low",
			headers: header("4b"),
			onPayload: (body: any) => {
				const next = { ...body, thinking: { type: "disabled" } };
				delete next.reasoning_effort;
				payload = next;
				return next;
			},
		},
	);
	const err = redact(message.errorMessage ?? "");
	const surfaced =
		message.stopReason === "error" &&
		(/thinking_required/i.test(err) || /always uses thinking/i.test(err) || /Use OMK\/coder/i.test(err));
	return {
		pass: Boolean(surfaced && payload?.model === "reasoner"),
		evidence: {
			wireModel: payload?.model,
			wireThinking: payload?.thinking ?? null,
			stopReason: message.stopReason,
			errorMessage: err,
		},
		notes: [
			"The client route (route.ts) never sends thinking:disabled for OMK/reasoner (off is clamped to low). This case deliberately rewrites the payload via onPayload so the request still goes through the client's HTTP and error path.",
		],
		clientBugs: surfaced
			? undefined
			: [
					`Client error path may not clearly include the gateway code/message. stopReason=${message.stopReason} errorMessage=${err}`,
				],
	};
});

await runCase("5a", "Missing token gives a clear auth error", async () => {
	const { message } = await collectStream(
		coder,
		{ messages: [{ role: "user", content: "no token", timestamp: Date.now() }] },
		{ maxTokens: 64, headers: header("5a") },
	);
	const streamErr = redact(message.errorMessage ?? "");
	const streamClear =
		message.stopReason === "error" &&
		(/No API key/i.test(streamErr) || /token_missing/i.test(streamErr) || /OMK_ACCOUNT_TOKEN/i.test(streamErr) || /No token provided/i.test(streamErr));

	const cli = await runCli(
		["--mode", "json", "-p", "--no-session", "--no-extensions", "--no-tools", "--model", "OMK/coder", "hi"],
		{ OMK_ACCOUNT_TOKEN: "" },
	);
	const cliBlob = `${cli.stdout}\n${cli.stderr}`;
	const cliClear =
		cli.code !== 0 &&
		(/No API key/i.test(cliBlob) ||
			/token_missing/i.test(cliBlob) ||
			/OMK_ACCOUNT_TOKEN/i.test(cliBlob) ||
			/No token provided/i.test(cliBlob) ||
			/not valid/i.test(cliBlob) ||
			/auth/i.test(cliBlob));
	return {
		pass: Boolean(streamClear && cliClear),
		evidence: {
			streamSimple: { stopReason: message.stopReason, errorMessage: streamErr },
			cli: { exitCode: cli.code, node: cli.node, termination: cli.termination, stdoutClip: clip(cli.stdout, 800), stderrClip: clip(cli.stderr, 800) },
		},
	};
});

await runCase("5b", "Bad token is rejected by the gateway and surfaced as a clear auth error", async () => {
	const bad = "omk_test_" + "x".repeat(32);
	const { message } = await collectStream(
		coder,
		{ messages: [{ role: "user", content: "bad token", timestamp: Date.now() }] },
		{ apiKey: bad, maxTokens: 64, headers: header("5b") },
	);
	const streamErr = redact(message.errorMessage ?? "");
	const streamClear =
		message.stopReason === "error" &&
		(/token_invalid/i.test(streamErr) || /not valid/i.test(streamErr) || /401/i.test(streamErr) || /authentication/i.test(streamErr));

	const cli = await runCli(
		["--mode", "json", "-p", "--no-session", "--no-extensions", "--no-tools", "--model", "OMK/coder", "hi"],
		{ OMK_ACCOUNT_TOKEN: bad },
	);
	const cliBlob = `${cli.stdout}\n${cli.stderr}`;
	const cliClear =
		cli.code !== 0 &&
		(/token_invalid/i.test(cliBlob) || /not valid/i.test(cliBlob) || /401/i.test(cliBlob) || /authentication/i.test(cliBlob));
	return {
		pass: Boolean(streamClear && cliClear),
		evidence: {
			streamSimple: { stopReason: message.stopReason, errorMessage: streamErr },
			cli: { exitCode: cli.code, node: cli.node, termination: cli.termination, stdoutClip: clip(cli.stdout, 800), stderrClip: clip(cli.stderr, 800) },
		},
		clientBugs: streamClear
			? undefined
			: [`Bad-token error may be unclear in streamSimple: ${streamErr}`],
	};
});

const report = {
	ok: cases.every((c) => c.pass),
	cases: redactJson(cases),
	diagnostics: redactJson(diagnostics),
	modelsRegistered: { coder: Boolean(coder), reasoner: Boolean(reasoner) },
};
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
console.error(redact(`[T-13] wrote report (${cases.filter((c) => c.pass).length}/${cases.length} passed)`));
process.exitCode = report.ok ? 0 : 1;
