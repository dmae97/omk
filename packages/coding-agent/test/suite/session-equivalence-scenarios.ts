import { fileURLToPath } from "node:url";
import { type AssistantMessage, fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { Type } from "typebox";
import { runGoldenScenario } from "../fixtures/spec103b/golden-scenario.ts";
import { createHarness, type Harness } from "./harness.ts";
import { type EquivalenceRecord, recordingSteps, sessionRecord } from "./session-equivalence.ts";

const FAKE_MCP_SERVER = fileURLToPath(new URL("../mcp/fake-server.mjs", import.meta.url));

export interface ScenarioRun {
	harness?: Harness;
	record: EquivalenceRecord;
}

const echoTool = {
	name: "echo",
	label: "Echo",
	description: "Echo the input back",
	parameters: Type.Object({ text: Type.String() }),
	execute: async (_id: string, params: unknown) => ({
		content: [{ type: "text" as const, text: (params as { text: string }).text }],
		details: {},
	}),
};

async function plainPrompt(): Promise<ScenarioRun> {
	const harness = await createHarness({ settings: { resourceGovernor: { mode: "off" } } });
	const requests: unknown[] = [];
	harness.setResponses(recordingSteps(requests, [fauxAssistantMessage("hello back")]));
	await harness.session.prompt("hello");
	return { harness, record: sessionRecord(harness, requests) };
}

async function toolRoundTrip(): Promise<ScenarioRun> {
	const harness = await createHarness({ settings: { resourceGovernor: { mode: "off" } }, tools: [echoTool] });
	const requests: unknown[] = [];
	harness.setResponses(
		recordingSteps(requests, [
			fauxAssistantMessage([fauxToolCall("echo", { text: "ping" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done after echo"),
		]),
	);
	await harness.session.prompt("use echo");
	return { harness, record: sessionRecord(harness, requests) };
}

/** Admission pressure: a small window with a tool set, so fitTools/admit run on every request. */
async function admissionPressure(): Promise<ScenarioRun> {
	const harness = await createHarness({
		models: [{ id: "faux-small", contextWindow: 8_000, maxTokens: 256 }],
		settings: { resourceGovernor: { mode: "off" } },
		tools: [echoTool],
	});
	const requests: unknown[] = [];
	harness.setResponses(
		recordingSteps(requests, [
			fauxAssistantMessage([fauxToolCall("echo", { text: "x".repeat(400) })], { stopReason: "toolUse" }),
			fauxAssistantMessage("fitted"),
		]),
	);
	await harness.session.prompt("pressure");
	return { harness, record: sessionRecord(harness, requests) };
}

async function retryTransient(): Promise<ScenarioRun> {
	const harness = await createHarness({
		settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 }, resourceGovernor: { mode: "off" } },
	});
	const requests: unknown[] = [];
	harness.setResponses(
		recordingSteps(requests, [
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "Network connection lost." }),
			fauxAssistantMessage("recovered"),
		]),
	);
	await harness.session.prompt("retry me");
	return { harness, record: sessionRecord(harness, requests) };
}

async function forcedCompaction(): Promise<ScenarioRun> {
	const harness = await createHarness({
		models: [{ id: "faux-1", contextWindow: 4_000, maxTokens: 100 }],
		settings: {
			compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0, maxUsageRatio: 0.8 },
			resourceGovernor: { mode: "off" },
		},
		extensionFactories: [
			(omk) => {
				omk.on("session_before_compact", async (event) => ({
					compaction: {
						summary: "equivalence summary",
						firstKeptEntryId: event.preparation.firstKeptEntryId,
						tokensBefore: event.preparation.tokensBefore,
						details: {},
					},
				}));
			},
		],
	});
	const model = harness.getModel();
	harness.sessionManager.appendMessage({ role: "user", content: [{ type: "text", text: "previous" }], timestamp: 1 });
	const big: AssistantMessage = {
		...fauxAssistantMessage("previous answer", { stopReason: "stop", timestamp: 2 }),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 3_400,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 3_400,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
	harness.sessionManager.appendMessage(big);
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
	const requests: unknown[] = [];
	harness.setResponses(
		recordingSteps(requests, [fauxAssistantMessage("after compaction"), fauxAssistantMessage("second")]),
	);
	await harness.session.prompt("next");
	await harness.session.prompt("and again");
	return { harness, record: sessionRecord(harness, requests) };
}

/** MCP catalog over the model's input budget: admission withholds the bulky server per request. */
async function mcpOverBudget(): Promise<ScenarioRun> {
	const harness = await createHarness({
		models: [{ id: "swe-sized", contextWindow: 262_000, maxTokens: 16_384 }],
		settings: {
			compaction: { enabled: true, reserveTokens: 8_192, keepRecentTokens: 10_000, maxUsageRatio: 0.7 },
			resourceGovernor: { mode: "off" },
		},
	});
	const server = (name: string, descriptionChars: number) => ({
		name,
		command: process.execPath,
		args: [FAKE_MCP_SERVER],
		env: { FAKE_MCP_MODE: "ok", FAKE_MCP_DESCRIPTION_CHARS: String(descriptionChars) },
		inheritEnv: false,
	});
	await harness.session.attachMcpServers({ servers: [server("bulky", 300_000), server("slim", 0)] });
	const requests: unknown[] = [];
	harness.setResponses(recordingSteps(requests, [fauxAssistantMessage("slim only")]));
	await harness.session.prompt("use the slim server");
	return { harness, record: sessionRecord(harness, requests) };
}

/** Spec 103b trace (`turns.jsonl`) and summary, caps flag off and on. */
async function spec103bTrace(): Promise<ScenarioRun> {
	const off = await runGoldenScenario({ OMK_NEXT_SUGGESTIONS: "1" });
	const on = await runGoldenScenario({ OMK_NEXT_SUGGESTIONS: "1", OMK_NEXT_SUGGESTIONS_CAPS: "1" });
	return { record: { requests: [], events: [], trace: { capsOff: off, capsOn: on } } };
}

export const SCENARIOS: Record<string, () => Promise<ScenarioRun>> = {
	"plain-prompt": plainPrompt,
	"tool-round-trip": toolRoundTrip,
	"admission-pressure": admissionPressure,
	"retry-transient": retryTransient,
	"forced-compaction": forcedCompaction,
	"mcp-over-budget": mcpOverBudget,
	"spec103b-trace": spec103bTrace,
};
