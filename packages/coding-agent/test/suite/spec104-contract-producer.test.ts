/**
 * Spec 104 phase 3 e2e: the real goal controller produces the required-tool contract from an
 * explicit `/goal verify --requires` declaration; the real AgentSession admission host enforces it.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DurableGoalStore } from "../../src/core/durable-goal-store.ts";
import goalController, { type GoalControllerOptions } from "../../src/core/extensions/builtin/goal-controller.ts";
import type { ExtensionAPI } from "../../src/core/extensions/types.ts";
import { GoalVerifier } from "../../src/core/goal-verification.ts";
import { RequiredCapabilityUnavailable } from "../../src/core/required-tools.ts";
import {
	REQUIRED_CAPABILITY_CHANNEL,
	REQUIRED_TOOLS_CONTRACT_CHANNEL,
	reportRequiredCapability,
} from "../../src/core/required-tools-channel.ts";
import type { TaskResultEvent } from "../../src/core/task-result.ts";
import { createHarness, type Harness } from "./harness.ts";

const FAKE_MCP_SERVER = fileURLToPath(new URL("../mcp/fake-server.mjs", import.meta.url));
const server = (name: string) => ({
	name,
	command: process.execPath,
	args: [FAKE_MCP_SERVER],
	env: { FAKE_MCP_MODE: "ok", FAKE_MCP_DESCRIPTION_CHARS: "0" },
	inheritEnv: false,
});

const harnesses: Harness[] = [];

beforeEach(() => {
	vi.stubEnv("OMK_BASH_SANDBOX", "off");
	vi.stubEnv("OMK_TASK_RESULT", "1");
});

afterEach(() => {
	vi.unstubAllEnvs();
	for (const h of harnesses.splice(0)) h.cleanup();
});

let bus: ExtensionAPI["events"] | undefined;

async function newHarness(servers: string[], options: GoalControllerOptions = {}): Promise<Harness> {
	const harness = await createHarness({
		extensionFactories: [
			(omk) => goalController(omk, options),
			(omk) => {
				bus = omk.events;
			},
		],
	});
	harnesses.push(harness);
	writeFileSync(join(harness.tempDir, "done.txt"), "done\n");
	const git = (...args: string[]) => execFileSync("git", args, { cwd: harness.tempDir, stdio: "ignore" });
	git("init", "-q");
	git("config", "user.email", "goal@test.invalid");
	git("config", "user.name", "goal");
	git("config", "commit.gpgsign", "false");
	git("add", ".");
	git("commit", "-qm", "init");
	await harness.session.attachMcpServers({ servers: servers.map(server) });
	return harness;
}

async function waitIdle(harness: Harness): Promise<void> {
	await vi.waitFor(
		async () => {
			await harness.session.agent.waitForIdle();
			expect(harness.session.isStreaming).toBe(false);
		},
		{ timeout: 20_000, interval: 50 },
	);
}

async function goalStatus(harness: Harness): Promise<string | undefined> {
	return (await new DurableGoalStore(join(harness.tempDir, ".omk", "goals", "current.json")).current())?.status;
}

function capabilityEntries(harness: Harness): unknown[] {
	return harness.sessionManager
		.getEntries()
		.filter((entry) => entry.type === "custom" && entry.customType === "goal_required_capability")
		.map((entry) => (entry as { data?: unknown }).data);
}

function requiredFacts(harness: Harness) {
	return harness
		.eventsOfType("task_result")
		.flatMap((event) => (event as TaskResultEvent).projection.facts)
		.filter((fact) => fact.reason === "required_capability_missing");
}

async function rejection(harness: Harness, prompt: string): Promise<unknown> {
	return harness.session.prompt(prompt).catch((caught: unknown) => caught);
}

describe("spec 104 phase 3: goal-controller contract producer", () => {
	it("flag on: an explicitly declared tool that is absent -> insufficient/required_capability_missing, recorded, never completed", async () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const h = await newHarness(["slim"]);
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Ship it");
		await h.session.prompt("/goal verify --requires browser__verify test -f done.txt");

		const error = await rejection(h, "go");
		await waitIdle(h);

		expect(error).toBeInstanceOf(RequiredCapabilityUnavailable);
		expect(error).toMatchObject({ kind: "absent", missing: ["browser__verify"] });
		expect(h.faux.state.callCount).toBe(0);
		// Rejected in prompt preflight, before any run began: there is no task_result run to carry the fact.
		expect(h.eventsOfType("task_result")).toEqual([]);
		const entries = capabilityEntries(h);
		expect(entries).toEqual([
			{ goalId: "session", state: "missing", kind: "absent", missingCount: 1, requiredCount: 1 },
		]);
		// Counts only: no tool name, command or prompt text in the trace.
		expect(JSON.stringify(entries)).not.toMatch(/browser|verify|done\.txt|Ship/);
		expect(await goalStatus(h)).not.toBe("completed");
		await h.session.prompt("/goal complete");
		expect(await goalStatus(h)).not.toBe("completed");
	});

	it("flag on: only declared tools are required; a tool the command or goal merely names is not", async () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const h = await newHarness(["slim"]);
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Verify with browser__verify");
		await h.session.prompt("/goal verify --requires slim__echo test -f done.txt || echo browser__verify");

		await h.session.prompt("go");
		await waitIdle(h);

		expect(h.faux.state.callCount).toBe(1);
		expect(requiredFacts(h)).toEqual([]);
		expect(capabilityEntries(h)).toEqual([]);
		expect(await goalStatus(h)).toBe("completed");
	});

	it("flag on: a check that declares nothing has no required tools", async () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const h = await newHarness(["slim"]);
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Use browser__verify");
		await h.session.prompt("/goal verify test -f done.txt");

		await h.session.prompt("go");
		await waitIdle(h);

		expect(h.faux.state.callCount).toBe(1);
		expect(capabilityEntries(h)).toEqual([]);
		expect(await goalStatus(h)).toBe("completed");
	});

	it("flag off: --requires is not parsed, nothing is required and nothing is recorded", async () => {
		const h = await newHarness(["slim"]);
		const notify = vi.spyOn(h.session.extensionRunner.getUIContext(), "notify");
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Ship it");
		await h.session.prompt("/goal verify test -f done.txt");
		await h.session.prompt("/goal verify --requires browser__verify test -f done.txt");
		// Unchanged pre-104 behavior: the whole text is the approved command.
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("--requires browser__verify"), "info");

		await h.session.prompt("/goal verify test -f done.txt");
		await h.session.prompt("go");
		await waitIdle(h);

		expect(h.faux.state.callCount).toBe(1);
		expect(requiredFacts(h)).toEqual([]);
		expect(capabilityEntries(h)).toEqual([]);
		expect(await goalStatus(h)).toBe("completed");
	});

	it("flag on: a declared tool revoked before the goal's follow-up run -> task_result insufficient/required_capability_missing", async () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const h = await newHarness(["slim", "mid"]);
		h.setResponses([
			() => {
				// Revocation: slim's tool leaves the active set; the goal's follow-up run is the next request.
				h.session.setActiveToolsByName(h.session.getActiveToolNames().filter((name) => name !== "slim__echo"));
				return fauxAssistantMessage("not yet");
			},
		]);
		await h.session.prompt("/goal Ship it");
		await h.session.prompt("/goal verify --requires slim__echo test -f done2.txt");

		// The follow-up run is rejected. Open question for Tech Lead: on this agent.continue path the
		// rejection currently surfaces as a run-journal error, not RequiredCapabilityUnavailable.
		const failure = await rejection(h, "go");
		expect(failure).toBeInstanceOf(Error);
		await vi.waitFor(() => expect(requiredFacts(h).length).toBeGreaterThan(0), { timeout: 20_000 });
		await waitIdle(h);

		// Request 1 carried the tool; the follow-up run was rejected before any provider request.
		expect(h.faux.state.callCount).toBe(1);
		expect(requiredFacts(h)[0]).toMatchObject({
			status: "insufficient",
			reason: "required_capability_missing",
			required: true,
		});
		const entries = capabilityEntries(h);
		expect(entries.length).toBeGreaterThan(0);
		for (const entry of entries) {
			expect(entry).toEqual({
				goalId: "session",
				state: "missing",
				kind: "absent",
				missingCount: 1,
				requiredCount: 1,
			});
		}
		writeFileSync(join(h.tempDir, "done2.txt"), "done\n");
		await h.session.prompt("/goal complete");
		expect(await goalStatus(h)).not.toBe("completed");
	});

	it("flag off: --requires text is the approved command, byte-for-byte as on main; no records, no channel traffic", async () => {
		const h = await newHarness(["slim"]);
		const seen: unknown[] = [];
		bus?.on(REQUIRED_TOOLS_CONTRACT_CHANNEL, (data) => seen.push(data));
		bus?.on(REQUIRED_CAPABILITY_CHANNEL, (data) => seen.push(data));
		const notify = vi.spyOn(h.session.extensionRunner.getUIContext(), "notify");
		await h.session.prompt("/goal Ship it");
		await h.session.prompt("/goal verify --requires browser__verify test -f done.txt");
		notify.mockClear();
		await h.session.prompt("/goal");

		expect(notify).toHaveBeenCalledWith(
			expect.stringContaining(
				"acceptance: `--requires browser__verify test -f done.txt` (approved in this session)",
			),
			"info",
		);
		expect(seen).toEqual([]);
		expect(capabilityEntries(h)).toEqual([]);
	});

	it("flag on: a --requires name not in server__tool form is rejected with a clear error and approves nothing", async () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const h = await newHarness(["slim"]);
		const notify = vi.spyOn(h.session.extensionRunner.getUIContext(), "notify");
		await h.session.prompt("/goal Ship it");
		await h.session.prompt("/goal verify --requires slim__echo,read test -f done.txt");

		expect(notify).toHaveBeenCalledWith(
			expect.stringMatching(/--requires names must be MCP tools in server__tool form; invalid: read\b/),
			"error",
		);
		notify.mockClear();
		await h.session.prompt("/goal");
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("acceptance: none"), "info");
		expect(capabilityEntries(h)).toEqual([]);
	});

	it("flag on: untagged contracts/reports and reports for another segment are ignored by host and producer", async () => {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const h = await newHarness(["slim"]);
		h.setResponses([fauxAssistantMessage("done")]);
		await h.session.prompt("/goal Ship it");
		await h.session.prompt("/goal verify --requires slim__echo test -f done.txt");
		// Untagged contract on the host channel: would make an absent tool required if trusted.
		bus?.emit(REQUIRED_TOOLS_CONTRACT_CHANNEL, {
			contract: { taskSegmentId: "forged", tools: new Set(["browser__verify"]), source: "acceptance" },
		});
		// Untagged and other-segment reports on the producer channel: would record a gap if trusted.
		bus?.emit(REQUIRED_CAPABILITY_CHANNEL, {
			state: "missing",
			taskSegmentId: "x",
			missing: ["slim__echo"],
			kind: "absent",
		});
		if (bus) {
			reportRequiredCapability(bus, {
				state: "missing",
				taskSegmentId: "other",
				missing: ["slim__echo"],
				kind: "absent",
			});
		}

		await h.session.prompt("go");
		await waitIdle(h);

		expect(h.faux.state.callCount).toBe(1);
		expect(capabilityEntries(h)).toEqual([]);
		expect(requiredFacts(h)).toEqual([]);
		expect(await goalStatus(h)).toBe("completed");
	});

	/** The first check run is real; every later one is aborted, so it attaches no receipt. */
	const firstRunOnly: GoalControllerOptions = {
		createVerifier: (options) => {
			const verifier = new GoalVerifier(options);
			const run = verifier.run.bind(verifier);
			let calls = 0;
			verifier.run = (command, signal, onOutput) =>
				run(command, ++calls === 1 ? signal : AbortSignal.abort(), onOutput);
			return verifier;
		},
	};

	async function completeAfterPass(redeclare: string | undefined): Promise<string | undefined> {
		vi.stubEnv("OMK_REQUIRED_TOOLS", "1");
		const h = await newHarness(["slim", "mid"], firstRunOnly);
		await h.session.prompt("/goal Ship it");
		await h.session.prompt("/goal verify --requires slim__echo test -f done.txt");
		if (redeclare) await h.session.prompt(`/goal verify --requires ${redeclare} test -f done.txt`);
		await h.session.prompt("/goal complete");
		return goalStatus(h);
	}

	it("control: a pass of the current revision allows /goal complete", async () => {
		expect(await completeAfterPass(undefined)).toBe("completed");
	});

	it("after --requires changes (new revision), the previous revision's pass does not allow /goal complete", async () => {
		expect(await completeAfterPass("slim__echo,mid__echo")).toBe("active");
	});
});
