import { describe, expect, it } from "vitest";
import finishCheck, {
	FINISH_CHECK_EVENT,
	FINISH_CHECK_LEDGER_ENTRY,
} from "../src/core/extensions/builtin/finish-check.ts";
import type { ExtensionAPI } from "../src/core/extensions/types.ts";
import { FINISH_CHECK_MAX_TOOL_CALLS, FINISH_CHECK_MESSAGE } from "../src/core/finish-check.ts";
import {
	buildFinishCheckMessage,
	extractRequirements,
	FINISH_CHECK_MAX_CHECKLIST_TOOL_CALLS,
	finishCheckToolCap,
	parseFinishCheckLedger,
} from "../src/core/finish-check-requirements.ts";

const DNA = `Design primers for the assembly.
The part of the primers annealed to the template sequence should have a length between 15 and 45 nucleotides. Have a melting temperature between 58 and 72 degrees celsius.
Write the primers to a file.`;

const FASTTEXT = `Train a fasttext model on the yelp data.
The final model size needs to be less than 150MB but get at least 0.62 accuracy on a private test set.
The model should be saved as /app/model.bin`;

// From terminal-bench-2-1 winning-avg-corewars and regex-chess instruction.md.
const COREWARS = [
	"Write your program to `my_warrior.red`. ",
	"Your warrior must achieve at least a 75% win rate (75+ wins out of 100 battles) against `stone.red`, `vampire.red`, and `paper.red`, and achieve at least a 33% win rate (33+ wins out of 100 battles) against `snake.red` and `g2-clear.red`.",
	"Testing will be performed using pMARS batch mode: `pmars -b -r 100 -f my_warrior.red warriors/<opponent>.red`.",
].join("\n");

const REGEX_CHESS = [
	"Write a JSON file called /app/re.json that is a list of [regex, replacement] pairs.",
	"The length of re.json must be under 100,000 [regex, replacement]-pairs long, and under 10 megabytes in total.",
].join("\n");

describe("finish-check requirement extraction", () => {
	it("keeps sentences that bound a number or name an absolute path", () => {
		expect(extractRequirements(DNA)).toEqual([
			"The part of the primers annealed to the template sequence should have a length between 15 and 45 nucleotides.",
			"Have a melting temperature between 58 and 72 degrees celsius.",
		]);
		expect(extractRequirements(FASTTEXT)).toEqual([
			"The final model size needs to be less than 150MB but get at least 0.62 accuracy on a private test set.",
			"The model should be saved as /app/model.bin",
		]);
		expect(extractRequirements("You image is in `/app/isos/win311.img`.")).toEqual([
			"You image is in `/app/isos/win311.img`.",
		]);
		expect(extractRequirements("Your warrior must win 33% of battles against snake.red.")).toHaveLength(1);
	});

	it("keeps relative files only when the sentence asks to produce them", () => {
		expect(extractRequirements("Write a c program image.c that renders the scene.")).toEqual([
			"Write a c program image.c that renders the scene.",
		]);
		expect(extractRequirements("The helper lives in utils.py.")).toEqual([]);
	});

	it("ignores plain goals, relative paths and code samples", () => {
		const prompt = [
			"Fix the failing build.",
			"Edit src/index.ts so it compiles.",
			"```python",
			'for pattern, repl in json.load(open("/app/re.json")):',
			"```",
			"    cat /app/notes.txt",
		].join("\n");
		expect(extractRequirements(prompt)).toEqual([]);
	});

	it("keeps numeric limits first when there are more items than slots, in prompt order", () => {
		const prompt = [
			"You are given /app/a.csv and /app/b.csv.",
			"Save the result to /app/out.csv.",
			"The error must be at most 0.1.",
		].join("\n");
		expect(extractRequirements(prompt, 2)).toEqual([
			"Save the result to /app/out.csv.",
			"The error must be at most 0.1.",
		]);
	});

	it("drops duplicates and shortens very long lines", () => {
		const long = `The output must be at least 5 lines ${"and more ".repeat(60)}`;
		const items = extractRequirements(`${long}\n${long}`);
		expect(items).toHaveLength(1);
		expect(items[0].length).toBe(400);
		expect(items[0].endsWith("…")).toBe(true);
	});

	// spec 035 AC16: the 220-character cut dropped the g2-clear 33% limit.
	it("keeps every limit of the corewars sentence", () => {
		const [item] = extractRequirements(COREWARS);
		for (const part of ["75%", "stone.red", "33%", "g2-clear.red"]) expect(item).toContain(part);
		expect(item.endsWith("…")).toBe(false);
	});

	// spec 035 AC17: shorter numeric items and path items keep #62's output.
	it("leaves other items and the path cut unchanged", () => {
		expect(extractRequirements(REGEX_CHESS)).toEqual([
			"Write a JSON file called /app/re.json that is a list of [regex, replacement] pairs.",
			"The length of re.json must be under 100,000 [regex, replacement]-pairs long, and under 10 megabytes in total.",
		]);
		const path = `Save the report to /app/report/${"nested/".repeat(40)}out.txt`;
		const [item] = extractRequirements(path);
		expect(item.length).toBe(220);
		expect(item.endsWith("…")).toBe(true);
	});
});

describe("finish-check checklist message and ledger", () => {
	it("leaves the message unchanged without requirements", () => {
		expect(buildFinishCheckMessage([])).toBe(FINISH_CHECK_MESSAGE);
		expect(finishCheckToolCap(0)).toBe(FINISH_CHECK_MAX_TOOL_CALLS);
	});

	it("numbers each requirement, asks for measured lines and raises the tool cap", () => {
		const items = extractRequirements(FASTTEXT);
		const message = buildFinishCheckMessage(items);
		expect(message).toContain("REQ 1: The final model size needs to be less than 150MB");
		expect(message).toContain("REQ 2: The model should be saved as /app/model.bin");
		expect(message).toContain("`REQ <n>: PASS|FAIL - <measured value>`");
		expect(message).toContain(`Use at most ${finishCheckToolCap(2)} tool calls`);
		expect(finishCheckToolCap(5)).toBe(8);
		expect(finishCheckToolCap(20)).toBe(FINISH_CHECK_MAX_CHECKLIST_TOOL_CALLS);
	});

	it("parses reported lines and marks missing ones unreported", () => {
		const reply = "Checked.\nREQ 1: FAIL - 48 nt\n- **REQ 3: PASS** — 3/3 pairs within 5 C";
		expect(parseFinishCheckLedger(reply, ["a", "b", "c"])).toEqual([
			{ id: 1, requirement: "a", status: "fail", measured: "48 nt" },
			{ id: 2, requirement: "b", status: "unreported", measured: undefined },
			{ id: 3, requirement: "c", status: "pass", measured: "3/3 pairs within 5 C" },
		]);
	});
});

type Handler = (event: unknown, ctx: unknown) => unknown;

function fakeOmk() {
	const handlers = new Map<string, Handler[]>();
	const sent: { text: string; deliverAs?: string }[] = [];
	const entries: { type: string; data: unknown }[] = [];
	const events: { channel: string; data: unknown }[] = [];
	const omk = {
		on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		sendUserMessage: (text: string, options?: { deliverAs?: string }) =>
			sent.push({ text, deliverAs: options?.deliverAs }),
		appendEntry: (type: string, data: unknown) => entries.push({ type, data }),
		events: { emit: (channel: string, data: unknown) => events.push({ channel, data }), on: () => () => {} },
	} as unknown as ExtensionAPI;
	const fire = async (name: string, event: unknown, ctx: unknown = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	return { omk, fire, sent, entries, events };
}

const ctx = { hasUI: false, hasPendingMessages: () => false };
const settled = (text: string) => ({
	messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text }] }],
});

describe("finish-check extension checklist flow", () => {
	it("sends the checklist, raises the cap, and records the ledger with start and end events", async () => {
		const { omk, fire, sent, entries, events } = fakeOmk();
		finishCheck(omk, { env: {} });
		await fire("input", { type: "input", text: FASTTEXT, source: "interactive" });
		await fire("tool_execution_end", { toolName: "write" });
		await fire("agent_settled", settled("done"), ctx);
		expect(sent.at(-1)?.text).toContain("REQ 2: The model should be saved as /app/model.bin");
		expect(events).toEqual([
			{ channel: FINISH_CHECK_EVENT, data: { active: true, requirements: extractRequirements(FASTTEXT) } },
		]);

		// The cap for two items is 6, so five check calls stay quiet and the sixth wraps up.
		for (let i = 0; i < 5; i++) await fire("tool_execution_end", { toolName: "bash" });
		expect(sent).toHaveLength(1);
		await fire("tool_execution_end", { toolName: "bash" });
		expect(sent.at(-1)?.deliverAs).toBe("steer");

		await fire("agent_settled", settled("REQ 1: FAIL - 0.58 acc\nREQ 2: PASS - 92MB at /app/model.bin"), ctx);
		const ledger = [
			{ id: 1, requirement: extractRequirements(FASTTEXT)[0], status: "fail", measured: "0.58 acc" },
			{
				id: 2,
				requirement: "The model should be saved as /app/model.bin",
				status: "pass",
				measured: "92MB at /app/model.bin",
			},
		];
		expect(entries).toEqual([{ type: FINISH_CHECK_LEDGER_ENTRY, data: { items: ledger } }]);
		expect(events.at(-1)).toEqual({ channel: FINISH_CHECK_EVENT, data: { active: false, ledger } });

		// The check runs once: a later settle sends nothing new.
		await fire("agent_settled", settled("ok"), ctx);
		expect(sent.filter((message) => message.deliverAs === "followUp")).toHaveLength(1);
	});

	it("still emits start and end events without measurable requirements, and writes no ledger", async () => {
		const { omk, fire, sent, entries, events } = fakeOmk();
		finishCheck(omk, { env: {} });
		await fire("input", { type: "input", text: "Fix the failing build.", source: "interactive" });
		await fire("tool_execution_end", { toolName: "edit" });
		await fire("agent_settled", settled("done"), ctx);
		expect(sent.at(-1)?.text).toBe(FINISH_CHECK_MESSAGE);
		await fire("agent_settled", settled("verified"), ctx);
		expect(entries).toEqual([]);
		expect(events.map((event) => (event.data as { active: boolean }).active)).toEqual([true, false]);
	});
});
