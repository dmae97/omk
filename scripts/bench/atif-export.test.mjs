/** Spec 110 tests: mapping, step order, agent-only fields, lossless round-trip, counts, masking. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { exportTrajectory, main, parseJsonl, readRunLog } from "./atif-export.mjs";
import { reverseTrajectory } from "./atif/reverse.mjs";
import { collectSecrets, maskString, rescan } from "./atif/mask.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => join(here, "fixtures", "atif", name);
const FIXTURES = ["plain", "tool-error", "worker"];
const AGENT_ONLY = ["model_name", "reasoning_effort", "reasoning_content", "tool_calls", "metrics"];

function load(name, env = {}) {
	const eventsText = readFileSync(join(fx(name), "events.jsonl"), "utf8");
	const { json, hits } = exportTrajectory({ eventsText, runLogDir: join(fx(name), "run-log"), env, version: "1.5.6" });
	return { eventsText, t: JSON.parse(json), json, hits };
}

describe("spec 110 ATIF export", () => {
	for (const name of FIXTURES) {
		describe(name, () => {
			const { eventsText, t } = load(name);
			const events = parseJsonl(eventsText);
			const { runLog } = readRunLog(join(fx(name), "run-log"));

			it("has required trajectory fields", () => {
				assert.equal(t.schema_version, "ATIF-v1.8");
				assert.equal(t.agent.name, "omk");
				assert.equal(typeof t.session_id, "string");
				assert.equal(t.agent.tool_definitions, undefined, "no tools in stream (Q3) -> omitted");
			});

			it("numbers steps 1..n and starts with a system placeholder (Q1)", () => {
				assert.deepEqual(t.steps.map((s) => s.step_id), t.steps.map((_, i) => i + 1));
				assert.equal(t.steps[0].source, "system");
				assert.equal(t.steps[0].extra.omk.systemPrompt.placeholder, true);
				assert.match(t.steps[0].message, /systemHash=sys0123abcd/);
				assert.equal(t.final_metrics.total_steps, t.steps.length);
			});

			it("keeps agent-only fields on agent steps", () => {
				for (const s of t.steps) if (s.source !== "agent") for (const f of AGENT_ONLY) assert.equal(s[f], undefined, `${f} on ${s.source}`);
				for (const s of t.steps) if (s.metrics) assert.ok(s.llm_call_count >= 1);
			});

			it("observation results reference tool calls of the same step", () => {
				for (const s of t.steps) for (const r of s.observation?.results ?? []) assert.ok(s.tool_calls.some((c) => c.tool_call_id === r.source_call_id));
			});

			it("counts match the inputs (criterion 3)", () => {
				const lead = runLog["llm-call"].filter((l) => l.role !== "worker").length;
				const matched = t.steps.filter((s) => s.metrics).length;
				assert.equal(matched + t.extra.omk.unmatchedLlmCalls.length, lead);
				const calls = t.steps.flatMap((s) => s.tool_calls ?? []).length;
				assert.equal(calls, events.filter((e) => e.type === "tool_execution_start").length);
				const results = t.steps.flatMap((s) => s.observation?.results ?? []).length;
				assert.equal(results, events.filter((e) => e.type === "tool_execution_end").length);
				const sum = t.steps.reduce((a, s) => a + (s.metrics?.prompt_tokens ?? 0), 0);
				assert.equal(t.final_metrics.total_prompt_tokens, sum);
			});

			it("round-trips losslessly (criterion 1)", () => {
				const back = reverseTrajectory(t);
				assert.deepStrictEqual(back.events, events);
				assert.deepStrictEqual(back.runLog, runLog);
			});

			it("puts no-slot llm-call fields under metrics.extra.omk by name", () => {
				const s = t.steps.find((x) => x.metrics);
				for (const k of ["cacheWrite", "responseId", "stopReason", "durationMs", "gapMs", "phase", "phaseSource", "systemHash", "toolsHash", "usageMissing", "costInUsdTicks", "provider", "requestedAtMs", "elapsedFraction", "pid", "role", "t"]) {
					if (k === "responseId" && name === "tool-error") continue;
					assert.ok(k in s.metrics.extra.omk, k);
				}
				const line = runLog["llm-call"].find((l) => l.role !== "worker");
				assert.equal(s.metrics.prompt_tokens, line.input + line.cacheRead + line.cacheWrite, "Q4");
				assert.equal(s.metrics.cached_tokens, line.cacheRead);
			});
		});
	}

	it("tool error keeps isError and unmatched retry line (Q5)", () => {
		const { t } = load("tool-error");
		const r = t.steps.flatMap((s) => s.observation?.results ?? [])[0];
		assert.equal(r.extra.omk.isError, true);
		assert.deepEqual(t.extra.omk.unmatchedLlmCalls.map((u) => u.record.responseId), ["resp_retry_aborted"]);
	});

	it("worker llm-call lines are kept, not joined to lead steps", () => {
		const { t } = load("worker");
		assert.equal(t.extra.omk.workerLlmCalls.length, 1);
		assert.equal(t.extra.omk.workerLlmCalls[0].record.role, "worker");
	});

	it("matches the checked-in validated sample (criterion 2)", () => {
		const { t } = load("plain");
		const sample = JSON.parse(readFileSync(fx("sample.trajectory.json"), "utf8"));
		const norm = (x) => {
			const c = structuredClone(x);
			c.agent.version = "X";
			for (const s of c.steps) delete s.timestamp;
			return c;
		};
		assert.deepStrictEqual(norm(t), norm(sample));
		const meta = JSON.parse(readFileSync(fx("sample.validator.json"), "utf8"));
		assert.equal(meta.schema_version, sample.schema_version);
	});

	it("uses full system prompt and tool definitions when omk_session_info is present", () => {
		const events = parseJsonl(readFileSync(join(fx("plain"), "events.jsonl"), "utf8"));
		const info = { type: "omk_session_info", systemPrompt: "You are omk.", tools: [{ name: "bash", description: "run", parameters: { type: "object" } }] };
		events.splice(1, 0, info);
		const eventsText = events.map((e) => JSON.stringify(e)).join("\n");
		const t = JSON.parse(exportTrajectory({ eventsText, runLogDir: join(fx("plain"), "run-log"), env: {}, version: "1" }).json);
		assert.equal(t.steps[0].message, "You are omk.");
		assert.equal(t.agent.tool_definitions[0].function.name, "bash");
		assert.deepStrictEqual(reverseTrajectory(t).events, events);
	});
});

describe("spec 110 follow-up: omk_session_info seq >= 2", () => {
	const info = (seq, h, prompt) => ({
		type: "omk_session_info",
		seq,
		systemHash: h.repeat(64),
		toolsHash: "1".repeat(64),
		systemPrompt: prompt,
		tools: [{ name: "bash", description: "run", parameters: { type: "object" } }],
	});
	const run = (events) => {
		const eventsText = events.map((e) => JSON.stringify(e)).join("\n");
		return JSON.parse(exportTrajectory({ eventsText, runLogDir: join(fx("plain"), "run-log"), env: {}, version: "1" }).json);
	};
	const base = () => parseJsonl(readFileSync(join(fx("plain"), "events.jsonl"), "utf8"));

	it("seq 1 only: no sessionInfoChanges, no per-step tag, round-trips", () => {
		const events = base();
		events.splice(1, 0, info(1, "a", "You are omk."));
		const t = run(events);
		assert.equal(t.extra.omk.sessionInfoChanges, undefined);
		for (const s of t.steps) assert.equal(s.extra?.omk?.sessionInfo, undefined);
		assert.deepStrictEqual(reverseTrajectory(t).events, events);
	});

	it("seq 2 hash change: kept in sessionInfoChanges, later agent steps tagged, round-trips", () => {
		const events = base();
		events.splice(1, 0, info(1, "a", "You are omk."));
		const firstAgent = events.findIndex((e) => e.type === "message_end" && e.message?.role === "assistant");
		const lastAgent = events.findLastIndex((e) => e.type === "message_end" && e.message?.role === "assistant");
		assert.ok(firstAgent < lastAgent, "fixture needs >= 2 assistant messages");
		events.splice(lastAgent, 0, info(2, "b", "You are omk (compacted)."));
		const t = run(events);
		assert.equal(t.steps[0].message, "You are omk.", "system step stays seq 1");
		assert.equal(t.extra.omk.sessionInfoChanges.length, 1);
		assert.equal(t.extra.omk.sessionInfoChanges[0].seq, 2);
		assert.equal(t.extra.omk.sessionInfoChanges[0].systemPrompt, "You are omk (compacted).");
		const agents = t.steps.filter((s) => s.source === "agent");
		assert.equal(agents[0].extra.omk.sessionInfo.seq, 1);
		assert.equal(agents[0].extra.omk.sessionInfo.systemHash, "a".repeat(64));
		assert.equal(agents.at(-1).extra.omk.sessionInfo.seq, 2);
		assert.equal(agents.at(-1).extra.omk.sessionInfo.systemHash, "b".repeat(64));
		assert.ok(t.steps.every((s, i) => s.step_id === i + 1));
		assert.deepStrictEqual(reverseTrajectory(t).events, events);
	});

	it("masks secrets inside a seq 2 line; rescan 0", () => {
		const FAKE = { TYPESAFE_API_KEY: "tsk_fake_0123456789abcdef" };
		const events = base();
		events.splice(1, 0, info(1, "a", "You are omk."));
		events.push(info(2, "b", `new ${FAKE.TYPESAFE_API_KEY} sk-abcdefghijklmnop1234 Bearer abc`));
		const eventsText = events.map((e) => JSON.stringify(e)).join("\n");
		const { json, hits } = exportTrajectory({ eventsText, runLogDir: join(fx("plain"), "run-log"), env: FAKE, version: "1" });
		const t = JSON.parse(json);
		assert.match(t.extra.omk.sessionInfoChanges[0].systemPrompt, /\[REDACTED:TYPESAFE_API_KEY\]/);
		assert.deepEqual(hits, []);
		assert.deepEqual(rescan(json, collectSecrets(FAKE)), []);
		assert.ok(!json.includes(FAKE.TYPESAFE_API_KEY));
		assert.ok(!/sk-abcdefghij|Bearer abc/.test(json));
	});
});

describe("spec 110 masking (criterion 4)", () => {
	const FAKE = {
		TYPESAFE_API_KEY: "tsk_fake_0123456789abcdef",
		GITHUB_TOKEN: "fake-gh-token-zzzzzzzzzz",
		DB_PASSWORD: "hunter2hunter2",
		SESSION_COOKIE: "cookie-value-123456",
		PLAIN_VALUE: "not-a-secret-value",
		SHORT_KEY: "1",
	};
	const leak = (s) => `use ${s} and sk-abcdefghijklmnop1234 and ghp_abcdefghijklmnopqrstuvwx and Bearer abcdefghijklmnopqrstu`;

	function leakyTrial() {
		const dir = mkdtempSync(join(tmpdir(), "atif-mask-"));
		const events = parseJsonl(readFileSync(join(fx("plain"), "events.jsonl"), "utf8"));
		const text = JSON.stringify(events)
			.replace("List the files in /app.", leak(FAKE.TYPESAFE_API_KEY))
			.replaceAll('"ls"', JSON.stringify(leak(FAKE.GITHUB_TOKEN)))
			.replace("a.txt\\nb.txt\\n", leak(`${FAKE.DB_PASSWORD} ${FAKE.SESSION_COOKIE}`));
		const eventsPath = join(dir, "events.jsonl");
		writeFileSync(eventsPath, JSON.parse(text).map((e) => JSON.stringify(e)).join("\n"));
		return { dir, eventsPath };
	}

	it("collects only secret-named env values of useful length", () => {
		assert.deepEqual(collectSecrets(FAKE).map((s) => s.name).sort(), ["DB_PASSWORD", "GITHUB_TOKEN", "SESSION_COOKIE", "TYPESAFE_API_KEY"]);
		assert.equal(maskString(`x ${FAKE.TYPESAFE_API_KEY} y`, collectSecrets(FAKE)), "x [REDACTED:TYPESAFE_API_KEY] y");
	});

	it("CLI output contains no fake secret and rescan finds 0 hits", () => {
		const { dir, eventsPath } = leakyTrial();
		const out = join(dir, "trajectory.json");
		try {
			assert.equal(main(["--events", eventsPath, "--run-log", join(fx("plain"), "run-log"), "--out", out], FAKE), 0);
			const bytes = readFileSync(out, "utf8");
			for (const k of ["TYPESAFE_API_KEY", "GITHUB_TOKEN", "DB_PASSWORD", "SESSION_COOKIE"]) {
				assert.ok(!bytes.includes(FAKE[k]), k);
				assert.ok(bytes.includes(`[REDACTED:${k}]`), k);
			}
			assert.ok(!/sk-abcdefghij|ghp_abcdefghij|Bearer abcdefghij/.test(bytes));
			assert.ok(bytes.includes(FAKE.PLAIN_VALUE) === false, "plain env values are never copied in");
			assert.ok(!bytes.includes("not-a-secret-value"));
			const { hits } = exportTrajectory({ eventsText: readFileSync(eventsPath, "utf8"), runLogDir: join(fx("plain"), "run-log"), env: FAKE, version: "1" });
			assert.deepEqual(hits, []);
			assert.ok(!JSON.stringify(JSON.parse(bytes)).includes('"SHORT_KEY"'));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("short key-shape prefixes stay; Bearer masks at any length", () => {
		const text = "a sk-x b xai-y c ghp_z e github_pat_w d Bearer q";
		assert.equal(maskString(text, []), "a sk-x b xai-y c ghp_z e github_pat_w d [REDACTED:PATTERN]");
		assert.deepEqual(rescan(maskString(text, []), []), []);
		assert.ok(rescan("Bearer q", []).length > 0, "rescan sees short Bearer too");
		assert.deepEqual(rescan("sk-1", []), []);
	});

	it("leaves sk-learn unmasked", () => {
		assert.equal(maskString("pip install sk-learn", []), "pip install sk-learn");
		assert.deepEqual(rescan("sk-learn", []), []);
	});

	it("masks a fake sk- key of 20+ characters", () => {
		const key = "sk-fake_ABCDEFGHIJ-0123456789";
		assert.ok(key.length - 3 >= 20);
		assert.equal(maskString(`k=${key};`, []), "k=[REDACTED:PATTERN];");
		assert.ok(rescan(key, []).length > 0);
	});

	it("masks and rescans extra.omk.eventLog (raw catch-all events)", () => {
		const events = parseJsonl(readFileSync(join(fx("plain"), "events.jsonl"), "utf8"));
		events.push({ type: "message_update", note: leak(FAKE.TYPESAFE_API_KEY), [FAKE.GITHUB_TOKEN]: FAKE.DB_PASSWORD });
		const eventsText = events.map((e) => JSON.stringify(e)).join("\n");
		const { json, hits } = exportTrajectory({ eventsText, runLogDir: join(fx("plain"), "run-log"), env: FAKE, version: "1" });
		const raw = JSON.parse(json).extra.omk.eventLog.at(-1).raw;
		assert.equal(raw.type, "message_update", "event landed in eventLog");
		assert.match(raw.note, /\[REDACTED:TYPESAFE_API_KEY\]/);
		assert.deepEqual(hits, []);
		for (const k of ["TYPESAFE_API_KEY", "GITHUB_TOKEN", "DB_PASSWORD"]) assert.ok(!json.includes(FAKE[k]), k);
	});

	it("spec 112 criterion 5: masks every omk_session_info string (seq 1 and a re-emitted seq 2); rescan 0", () => {
		const events = parseJsonl(readFileSync(join(fx("plain"), "events.jsonl"), "utf8"));
		const info = (seq) => ({
			type: "omk_session_info",
			seq,
			systemHash: "0".repeat(64),
			toolsHash: "1".repeat(64),
			systemPrompt: `You are omk. ${leak(FAKE.TYPESAFE_API_KEY)} xai-abcdefghijklmnopqrst`,
			tools: [
				{
					name: "bash",
					description: `run ${leak(FAKE.GITHUB_TOKEN)}`,
					parameters: { type: "object", properties: { cmd: { type: "string", description: `e.g. ${FAKE.DB_PASSWORD}`, default: "Bearer abcdefghijklmnopqrstu" } } },
				},
			],
		});
		events.splice(1, 0, info(1));
		events.push(info(2));
		const eventsText = events.map((e) => JSON.stringify(e)).join("\n");
		const { json, hits } = exportTrajectory({ eventsText, runLogDir: join(fx("plain"), "run-log"), env: FAKE, version: "1" });
		const t = JSON.parse(json);
		assert.match(t.steps[0].message, /^You are omk\. use \[REDACTED:TYPESAFE_API_KEY\]/);
		assert.match(t.agent.tool_definitions[0].function.description, /\[REDACTED:GITHUB_TOKEN\]/);
		assert.deepEqual(hits, []);
		assert.deepEqual(rescan(json, collectSecrets(FAKE)), []);
		for (const k of ["TYPESAFE_API_KEY", "GITHUB_TOKEN", "DB_PASSWORD"]) assert.ok(!json.includes(FAKE[k]), k);
		assert.ok(!/sk-abcdefghij|ghp_abcdefghij|xai-abcdefghij|Bearer abcdefghij/.test(json));
	});

	it("masks agent-env secret names given by --mask-env-names / OMK_ATIF_MASK_ENV_NAMES", () => {
		const env = { HARBOR_TRIAL_NONCE: "nonce-value-abcdef", MODEL_ENDPOINT_ID: "endpoint-id-987654" };
		const { dir, eventsPath } = leakyTrial();
		const text = readFileSync(eventsPath, "utf8").replace("Listing.", `${env.HARBOR_TRIAL_NONCE} ${env.MODEL_ENDPOINT_ID}`);
		writeFileSync(eventsPath, text);
		const out = join(dir, "t.json");
		try {
			assert.equal(collectSecrets(env).length, 0, "names do not match the default regex");
			assert.equal(main(["--events", eventsPath, "--mask-env-names", "HARBOR_TRIAL_NONCE", "--out", out], { ...env, OMK_ATIF_MASK_ENV_NAMES: "MODEL_ENDPOINT_ID" }), 0);
			const bytes = readFileSync(out, "utf8");
			assert.ok(bytes.includes("[REDACTED:HARBOR_TRIAL_NONCE]") && bytes.includes("[REDACTED:MODEL_ENDPOINT_ID]"));
			assert.ok(!bytes.includes(env.HARBOR_TRIAL_NONCE) && !bytes.includes(env.MODEL_ENDPOINT_ID));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("exits 2 and writes no file when the rescan finds a hit", () => {
		const { dir, eventsPath } = leakyTrial();
		const out = join(dir, "t.json");
		try {
			// Test-only hook re-injects a secret after masking, so only the rescan can catch it.
			const afterMask = (t) => ({ ...t, extra: { ...t.extra, leaked: FAKE.TYPESAFE_API_KEY } });
			assert.equal(main(["--events", eventsPath, "--out", out], FAKE, { afterMask }), 2);
			assert.equal(existsSync(out), false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects bad arguments with exit 1", () => {
		assert.equal(main(["--events"], {}), 1);
		assert.equal(main(["--bogus", "x"], {}), 1);
	});
});
