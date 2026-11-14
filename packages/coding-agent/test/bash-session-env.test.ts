import { Buffer } from "node:buffer";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { type BashOperations, createBashToolDefinition } from "../src/core/tools/bash.ts";

describe("bash tool session environment", () => {
	const suffixes = ["SESSION_ID", "SESSION_FILE", "PROVIDER", "MODEL", "REASONING_LEVEL"] as const;
	let tempDir: string;

	function spoofParentSession(): void {
		for (const suffix of suffixes) {
			vi.stubEnv(`OMK_${suffix}`, `stale-omk-${suffix}`);
			vi.stubEnv(`PI_${suffix}`, `stale-pi-${suffix}`);
		}
	}

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-bash-session-env-"));
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	function captureOperations(captured: { env?: NodeJS.ProcessEnv }): BashOperations {
		return {
			exec: async (_command, _cwd, { onData, env }) => {
				captured.env = env;
				onData(Buffer.from("ok"));
				return { exitCode: 0 };
			},
		};
	}

	function sessionContext(): ExtensionContext {
		return {
			cwd: tempDir,
			hasUI: false,
			model: { provider: "xai", id: "grok-4.5" },
			thinkingLevel: "high",
			sessionManager: {
				getSessionId: () => "session-abc",
				getSessionFile: () => "/tmp/session-abc.jsonl",
			},
		} as unknown as ExtensionContext;
	}

	it("injects PI_* session metadata into the spawned environment", async () => {
		const captured: { env?: NodeJS.ProcessEnv } = {};
		const bash = createBashToolDefinition(tempDir, { operations: captureOperations(captured) });

		await bash.execute("bash-1", { command: "true" }, undefined, undefined, sessionContext());

		expect(captured.env?.PI_SESSION_ID).toBe("session-abc");
		expect(captured.env?.PI_SESSION_FILE).toBe("/tmp/session-abc.jsonl");
		expect(captured.env?.PI_PROVIDER).toBe("xai");
		expect(captured.env?.PI_MODEL).toBe("grok-4.5");
		expect(captured.env?.PI_REASONING_LEVEL).toBe("high");
	});

	it("never inherits spoofed PI_* values from the parent environment", async () => {
		const previous = process.env.PI_SESSION_ID;
		process.env.PI_SESSION_ID = "spoofed";
		try {
			const captured: { env?: NodeJS.ProcessEnv } = {};
			const bash = createBashToolDefinition(tempDir, { operations: captureOperations(captured) });

			// Without ctx, the spoofed value must be stripped, not inherited.
			await bash.execute(
				"bash-1",
				{ command: "true" },
				undefined,
				undefined,
				undefined as unknown as ExtensionContext,
			);
			expect(captured.env?.PI_SESSION_ID).toBeUndefined();

			// With ctx, the session value wins over the parent env.
			await bash.execute("bash-2", { command: "true" }, undefined, undefined, sessionContext());
			expect(captured.env?.PI_SESSION_ID).toBe("session-abc");
		} finally {
			if (previous === undefined) delete process.env.PI_SESSION_ID;
			else process.env.PI_SESSION_ID = previous;
		}
	});

	it("omits PI_* variables when exposeSessionEnvironment is false", async () => {
		const captured: { env?: NodeJS.ProcessEnv } = {};
		const bash = createBashToolDefinition(tempDir, {
			operations: captureOperations(captured),
			exposeSessionEnvironment: false,
		});

		await bash.execute("bash-1", { command: "true" }, undefined, undefined, sessionContext());

		expect(captured.env?.PI_SESSION_ID).toBeUndefined();
		expect(captured.env?.PI_SESSION_FILE).toBeUndefined();
		expect(captured.env?.PI_PROVIDER).toBeUndefined();
		expect(captured.env?.PI_MODEL).toBeUndefined();
		expect(captured.env?.PI_REASONING_LEVEL).toBeUndefined();
	});

	it("exports matching OMK_* aliases without changing PI_* metadata", async () => {
		spoofParentSession();
		const captured: { env?: NodeJS.ProcessEnv } = {};
		const bash = createBashToolDefinition(tempDir, { operations: captureOperations(captured) });
		await bash.execute("aliases", { command: "true" }, undefined, undefined, sessionContext());
		const values = ["session-abc", "/tmp/session-abc.jsonl", "xai", "grok-4.5", "high"];
		for (const [index, suffix] of suffixes.entries()) {
			expect(captured.env?.[`OMK_${suffix}`]).toBe(values[index]);
			expect(captured.env?.[`PI_${suffix}`]).toBe(values[index]);
		}
	});

	it.each(["missing-context", "disabled", "missing-session-manager"])(
		"strips both inherited namespaces when %s",
		async (mode) => {
			spoofParentSession();
			const captured: { env?: NodeJS.ProcessEnv } = {};
			const ctx = mode === "missing-context" ? (undefined as unknown as ExtensionContext) : sessionContext();
			if (ctx && mode === "missing-session-manager") Reflect.deleteProperty(ctx, "sessionManager");
			const bash = createBashToolDefinition(tempDir, {
				operations: captureOperations(captured),
				exposeSessionEnvironment: mode !== "disabled",
			});
			await bash.execute("scrub", { command: "true" }, undefined, undefined, ctx);
			for (const suffix of suffixes) {
				expect(captured.env?.[`OMK_${suffix}`]).toBeUndefined();
				expect(captured.env?.[`PI_${suffix}`]).toBeUndefined();
			}
		},
	);

	it("omits absent metadata in both namespaces and refreshes it on the next call", async () => {
		spoofParentSession();
		const captured: { env?: NodeJS.ProcessEnv } = {};
		const ctx = sessionContext();
		ctx.sessionManager.getSessionFile = () => undefined;
		ctx.model = undefined;
		ctx.thinkingLevel = undefined;
		const bash = createBashToolDefinition(tempDir, { operations: captureOperations(captured) });
		await bash.execute("ephemeral", { command: "true" }, undefined, undefined, ctx);
		for (const prefix of ["OMK", "PI"]) {
			expect(captured.env?.[`${prefix}_SESSION_ID`]).toBe("session-abc");
			for (const suffix of suffixes.slice(1)) expect(captured.env).not.toHaveProperty(`${prefix}_${suffix}`);
		}
		const next = sessionContext();
		next.sessionManager.getSessionId = () => "session-next";
		next.thinkingLevel = "off";
		if (next.model) next.model = { ...next.model, provider: "openai", id: "gpt-next" };
		await bash.execute("next", { command: "true" }, undefined, undefined, next);
		for (const prefix of ["OMK", "PI"]) {
			expect(captured.env?.[`${prefix}_SESSION_ID`]).toBe("session-next");
			expect(captured.env?.[`${prefix}_MODEL`]).toBe("gpt-next");
			expect(captured.env?.[`${prefix}_PROVIDER`]).toBe("openai");
			expect(captured.env?.[`${prefix}_REASONING_LEVEL`]).toBe("off");
		}
	});

	it("provides both namespaces to the trusted spawn hook without mutating the parent", async () => {
		spoofParentSession();
		const captured: { env?: NodeJS.ProcessEnv } = {};
		const bash = createBashToolDefinition(tempDir, {
			operations: captureOperations(captured),
			spawnHook: (context) => {
				expect(context.env.OMK_SESSION_ID).toBe("session-abc");
				expect(context.env.PI_SESSION_ID).toBe("session-abc");
				return { ...context, env: { ...context.env, CI: "hook-value" } };
			},
		});
		await bash.execute("hook", { command: "true" }, undefined, undefined, sessionContext());
		expect(captured.env?.CI).toBe("hook-value");
		expect(process.env.OMK_SESSION_ID).toBe("stale-omk-SESSION_ID");
		expect(process.env.PI_SESSION_ID).toBe("stale-pi-SESSION_ID");
	});

	it.each([true, false])("passes the metadata policy to a real shell, exposure=%s", async (expose) => {
		spoofParentSession();
		const keys = suffixes.flatMap((suffix) => [`OMK_${suffix}`, `PI_${suffix}`]);
		const command = `printf '%s\\n' ${keys.map((key) => `"${key}=\${${key}-unset}"`).join(" ")}`;
		const bash = createBashToolDefinition(tempDir, { exposeSessionEnvironment: expose });
		const result = await bash.execute("child", { command, timeout: 5 }, undefined, undefined, sessionContext());
		const values = ["session-abc", "/tmp/session-abc.jsonl", "xai", "grok-4.5", "high"];
		const expected = keys.map((key, index) => `${key}=${expose ? values[Math.floor(index / 2)] : "unset"}`);
		expect(result.content).toEqual([{ type: "text", text: `${expected.join("\n")}\n` }]);
	});

	it("advertises PI_* inspection in prompt guidelines only when exposure is enabled", () => {
		const enabled = createBashToolDefinition(tempDir, {
			operations: captureOperations({}),
		});
		const disabled = createBashToolDefinition(tempDir, {
			operations: captureOperations({}),
			exposeSessionEnvironment: false,
		});

		expect(enabled.promptGuidelines?.join(" ")).toContain("PI_*");
		expect(disabled.promptGuidelines).toBeUndefined();
	});
});
