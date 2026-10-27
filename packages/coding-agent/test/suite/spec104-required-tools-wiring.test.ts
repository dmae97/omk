/** Spec 104 phase 2: the session's turn-admission host supplies the required-tool contract (flag on only). */

import { fileURLToPath } from "node:url";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setRequiredToolSource } from "../../src/core/agent-session-turn-admission-host.ts";
import { RequiredCapabilityUnavailable, type RequiredToolContract } from "../../src/core/required-tools.ts";
import { createHarness, type Harness } from "./harness.ts";

const FAKE_MCP_SERVER = fileURLToPath(new URL("../mcp/fake-server.mjs", import.meta.url));

let harness: Harness | undefined;
afterEach(() => {
	harness?.cleanup();
	harness = undefined;
	delete process.env.OMK_REQUIRED_TOOLS;
	vi.restoreAllMocks();
});

const server = (name: string, descriptionChars: number) => ({
	name,
	command: process.execPath,
	args: [FAKE_MCP_SERVER],
	env: { FAKE_MCP_MODE: "ok", FAKE_MCP_DESCRIPTION_CHARS: String(descriptionChars) },
	inheritEnv: false,
});

const contract = (...tools: string[]): RequiredToolContract => ({
	taskSegmentId: "goal-1",
	tools: new Set(tools),
	source: "acceptance",
});

/** A 262k-window model whose MCP catalog outgrows its tool budget (agent-session-input-admission). */
async function overBudgetSession(servers: Array<[string, number]>): Promise<Harness> {
	const created = await createHarness({
		models: [{ id: "swe-sized", contextWindow: 262_000, maxTokens: 16_384 }],
		settings: {
			compaction: { enabled: true, reserveTokens: 8_192, keepRecentTokens: 10_000, maxUsageRatio: 0.7 },
			resourceGovernor: { mode: "off" },
		},
	});
	await created.session.attachMcpServers({ servers: servers.map(([name, chars]) => server(name, chars)) });
	return created;
}

function recordMcpTools(target: Harness, count: number): string[][] {
	const sent: string[][] = [];
	const step = (context: { tools?: readonly { name: string }[] }) => {
		sent.push(
			(context.tools ?? [])
				.map((tool) => tool.name)
				.filter((name) => name.includes("__"))
				.sort(),
		);
		return fauxAssistantMessage("ok");
	};
	target.setResponses(Array.from({ length: count }, () => step));
	return sent;
}

/**
 * bulky + mid outgrow the tool budget; bulky alone (pinned) still fits the input ceiling.
 * These 150k/100k description sizes are tied to the current tool-budget formula
 * (toolSchemaBudgetTokens / sessionInputTokenLimit for a 262k window); retune them if it changes.
 */
const CATALOG: Array<[string, number]> = [
	["bulky", 150_000],
	["mid", 100_000],
	["slim", 0],
];

/** In-process `gc()` (V8 flag set at runtime), so retention is checked deterministically, not by timing. */
function forceGc(): () => void {
	setFlagsFromString("--expose-gc");
	return runInNewContext("gc") as () => void;
}

async function collected(register: (registry: FinalizationRegistry<string>) => void | Promise<void>): Promise<boolean> {
	let done = false;
	const registry = new FinalizationRegistry<string>(() => {
		done = true;
	});
	await register(registry);
	const gc = forceGc();
	for (let i = 0; i < 20 && !done; i++) {
		gc();
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	return done;
}

const groupsOf = (names: readonly string[] | undefined) => [...new Set((names ?? []).map((n) => n.split("__")[0]))];

describe("spec 104 wiring: required tools in real sessions", () => {
	it("flag off: a supplied contract changes nothing; the largest server is withheld as before", async () => {
		harness = await overBudgetSession(CATALOG);
		setRequiredToolSource(harness.session, () => contract("bulky__echo"));
		const sent = recordMcpTools(harness, 1);

		await harness.session.prompt("hello");

		expect(groupsOf(sent[0])).toEqual(["mid", "slim"]);
	});

	it("flag on: the MCP server holding a required tool stays under admission pressure; another is withheld instead", async () => {
		process.env.OMK_REQUIRED_TOOLS = "1";
		harness = await overBudgetSession(CATALOG);
		setRequiredToolSource(harness.session, () => contract("bulky__echo"));
		const notify = vi.spyOn(harness.session.extensionRunner.getUIContext(), "notify");
		const sent = recordMcpTools(harness, 1);

		await harness.session.prompt("verify in the browser");

		expect(groupsOf(sent[0])).toEqual(["bulky", "slim"]);
		expect(harness.session.getActiveToolNames()).toEqual(expect.arrayContaining(["mid__echo"]));
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("withhold mid"), "warning");
	});

	it("flag on without a contract: admission behaves exactly as flag off", async () => {
		process.env.OMK_REQUIRED_TOOLS = "1";
		harness = await overBudgetSession(CATALOG);
		const sent = recordMcpTools(harness, 1);

		await harness.session.prompt("hello");

		expect(groupsOf(sent[0])).toEqual(["mid", "slim"]);
	});

	it("flag on: a required tool that is not present rejects the turn before any provider request", async () => {
		process.env.OMK_REQUIRED_TOOLS = "1";
		harness = await overBudgetSession([["slim", 0]]);
		setRequiredToolSource(harness.session, () => contract("browser__verify"));
		recordMcpTools(harness, 1);

		const error = await harness.session.prompt("hello").catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(RequiredCapabilityUnavailable);
		expect(error).toMatchObject({ kind: "absent", missing: ["browser__verify"], taskSegmentId: "goal-1" });
		expect(harness.faux.state.callCount).toBe(0);
	});

	it("flag on: a required tool added mid-segment is on the very next request", async () => {
		process.env.OMK_REQUIRED_TOOLS = "1";
		harness = await overBudgetSession(CATALOG);
		let required: RequiredToolContract | undefined;
		setRequiredToolSource(harness.session, () => required);
		const sent = recordMcpTools(harness, 2);

		await harness.session.prompt("first");
		required = contract("bulky__echo");
		await harness.session.prompt("second");

		expect(groupsOf(sent[0])).toEqual(["mid", "slim"]);
		expect(groupsOf(sent[1])).toEqual(["bulky", "slim"]);
	});

	it("flag on: clearing the source restores the unpinned fit", async () => {
		process.env.OMK_REQUIRED_TOOLS = "1";
		harness = await overBudgetSession(CATALOG);
		setRequiredToolSource(harness.session, () => contract("bulky__echo"));
		const sent = recordMcpTools(harness, 2);

		await harness.session.prompt("first");
		setRequiredToolSource(harness.session, undefined);
		await harness.session.prompt("second");

		expect(groupsOf(sent[0])).toEqual(["bulky", "slim"]);
		expect(groupsOf(sent[1])).toEqual(["mid", "slim"]);
	});

	it("flag on: required groups that cannot fit the input ceiling even after compaction are rejected, never dropped", async () => {
		process.env.OMK_REQUIRED_TOOLS = "1";
		harness = await createHarness({
			models: [{ id: "small-window", contextWindow: 16_000, maxTokens: 1_000 }],
			settings: {
				compaction: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 1_000, maxUsageRatio: 0.7 },
				resourceGovernor: { mode: "off" },
			},
		});
		await harness.session.attachMcpServers({ servers: [server("bulky", 300_000)] });
		setRequiredToolSource(harness.session, () => contract("bulky__echo"));
		recordMcpTools(harness, 1);

		const error = await harness.session.prompt("hello").catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(RequiredCapabilityUnavailable);
		expect(error).toMatchObject({ kind: "over_ceiling", missing: ["bulky__echo"] });
		expect(harness.faux.state.callCount).toBe(0);
	});

	it("flag on: within one segment with no changes, three requests carry identical tool names, order and schemas", async () => {
		process.env.OMK_REQUIRED_TOOLS = "1";
		harness = await overBudgetSession(CATALOG);
		setRequiredToolSource(harness.session, () => contract("bulky__echo"));
		const payloads: string[] = [];
		const step = (context: { tools?: readonly unknown[] }) => {
			payloads.push(JSON.stringify(context.tools));
			return fauxAssistantMessage("ok");
		};
		harness.setResponses([step, step, step]);

		for (const text of ["one", "two", "three"]) await harness.session.prompt(text);

		expect(payloads).toHaveLength(3);
		expect(new Set(payloads).size).toBe(1);
		expect(payloads[0]).toContain("bulky__echo");
		expect(payloads[0]).not.toContain("mid__echo");
	});

	it("flag on: a required MCP tool revoked between two requests in one segment rejects the next prompt as absent", async () => {
		process.env.OMK_REQUIRED_TOOLS = "1";
		harness = await overBudgetSession(CATALOG);
		setRequiredToolSource(harness.session, () => contract("bulky__echo"));
		const sent = recordMcpTools(harness, 2);

		await harness.session.prompt("first");
		expect(groupsOf(sent[0])).toEqual(["bulky", "slim"]);
		const callsBefore = harness.faux.state.callCount;
		// Revocation: the bulky server's tools leave the session's tool set before request N+1.
		await harness.session.attachMcpServers({ servers: [server("mid", 100_000), server("slim", 0)] });
		expect(harness.session.getActiveToolNames()).not.toContain("bulky__echo");

		const error = await harness.session.prompt("second").catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(RequiredCapabilityUnavailable);
		expect(error).toMatchObject({ kind: "absent", missing: ["bulky__echo"], taskSegmentId: "goal-1" });
		expect(harness.faux.state.callCount).toBe(callsBefore);
		expect(sent).toHaveLength(1);
	});

	it("the source store does not retain a session: a dropped key's source is garbage-collected", async () => {
		const ok = await collected((registry) => {
			let key: object | undefined = {};
			let source: (() => RequiredToolContract | undefined) | undefined = () => contract("bulky__echo");
			setRequiredToolSource(key, source);
			registry.register(source, "source");
			source = undefined;
			key = undefined;
		});
		expect(ok).toBe(true);
	});

	it("a disposed, unreferenced session releases its source", async () => {
		const ok = await collected((registry) => {
			let created: Harness | undefined;
			return createHarness({ settings: { resourceGovernor: { mode: "off" } } }).then((h) => {
				created = h;
				const source = () => contract("bulky__echo");
				setRequiredToolSource(created.session, source);
				registry.register(source, "source");
				created.cleanup();
				created = undefined;
			});
		});
		expect(ok).toBe(true);
	});
});
