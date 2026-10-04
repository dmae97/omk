import { existsSync, readFileSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { fauxAssistantMessage } from "omk-ai";
import { describe, expect, it } from "vitest";
import { runSdkSessionCli } from "../../src/commands/sdk-session-cli.ts";
import { requestSessionControl } from "../../src/core/session-control-client.ts";
import { controlEndpointPath, readControlEndpoint } from "../../src/core/session-control-endpoint.ts";
import { phase3Gate } from "../fixtures/phase3-gate.ts";
import { assistantMsg } from "../utilities.ts";
import { createHarness, getUserTexts } from "./harness.ts";

describe.skipIf(process.platform === "win32")("native local session control", () => {
	it("delivers CLI --live to the real session and removes the endpoint on close", async () => {
		const h = await createHarness({ persistSession: true });
		h.sessionManager.appendMessage(assistantMsg("seed"));
		const file = h.session.sessionFile;
		if (!file) throw new Error("missing session file");
		const settled = phase3Gate<void>();
		h.session.subscribe((event) => {
			if (event.type === "prompt_settled") settled.resolve();
		});
		try {
			h.setResponses([fauxAssistantMessage("offline reply")]);
			await h.session.startControl();
			const endpoint = readControlEndpoint(file);
			expect(statSync(controlEndpointPath(file)).mode & 0o777).toBe(0o600);
			const output: string[] = [];
			const result = await runSdkSessionCli(
				[
					"sdk",
					"session",
					"send",
					h.session.sessionId,
					"live fixture",
					"--live",
					"--session-dir",
					h.sessionManager.getSessionDir(),
				],
				{ cwd: h.tempDir, writeLine: (text) => output.push(text) },
			);
			expect(result.exitCode).toBe(0);
			expect(output.join("\n")).toContain("accepted");
			expect(output.join("\n")).not.toContain(endpoint.token);
			await settled.promise;
			expect(getUserTexts(h)).toContain("live fixture");
			expect(h.getPendingResponseCount()).toBe(0);
			const status = await requestSessionControl(file, h.session.sessionId, "status");
			expect(status.state?.streaming).toBe(false);
			await h.session.close();
			expect(existsSync(controlEndpointPath(file))).toBe(false);
			expect(existsSync(endpoint.socketPath)).toBe(false);
		} finally {
			await h.session.close();
			h.cleanup();
		}
	});

	it("refuses foreign tokens and identities without dispatch or transcript mutation", async () => {
		const h = await createHarness({ persistSession: true });
		h.sessionManager.appendMessage(assistantMsg("seed"));
		const file = h.session.sessionFile;
		if (!file) throw new Error("missing session file");
		try {
			await h.session.startControl();
			const endpoint = readControlEndpoint(file);
			const before = readFileSync(file, "utf8");
			for (const change of [{ token: "0".repeat(64) }, { sessionId: "foreign" }]) {
				const response = await new Promise<string>((resolve, reject) => {
					const socket = createConnection(endpoint.socketPath);
					let output = "";
					socket.setEncoding("utf8");
					socket.on("error", reject);
					socket.on("data", (data) => {
						output += data;
					});
					socket.on("end", () => {
						socket.destroy();
						resolve(output);
					});
					socket.on("connect", () =>
						socket.write(
							`${JSON.stringify({ version: 1, sessionId: endpoint.sessionId, token: endpoint.token, requestId: "negative", action: "prompt", text: "must not run", ...change })}\n`,
						),
					);
				});
				expect(response).toContain("refused");
			}
			expect(readFileSync(file, "utf8")).toBe(before);
		} finally {
			await h.session.close();
			h.cleanup();
		}
	});

	it("cancels a live request held in preflight without dispatching the model", async () => {
		const entered = phase3Gate<void>();
		const release = phase3Gate<void>();
		const h = await createHarness({
			persistSession: true,
			extensionFactories: [
				(api) =>
					api.on("input", async () => {
						entered.resolve();
						await release.promise;
						return { action: "continue" };
					}),
			],
		});
		await h.session.bindExtensions({});
		h.sessionManager.appendMessage(assistantMsg("seed"));
		const file = h.session.sessionFile;
		if (!file) throw new Error("missing session file");
		h.setResponses([fauxAssistantMessage("not dispatched")]);
		let request: ReturnType<typeof requestSessionControl> | undefined;
		try {
			await h.session.startControl();
			request = requestSessionControl(file, h.session.sessionId, "prompt", "held input");
			await entered.promise;
			expect((await requestSessionControl(file, h.session.sessionId, "abort")).status).toBe("accepted");
			release.resolve();
			expect((await request).status).toBe("refused");
			expect(h.session.lastTermination?.kind).toBe("user_abort");
			expect(h.getPendingResponseCount()).toBe(1);
		} finally {
			release.resolve();
			await request?.catch(() => {});
			await h.session.close();
			h.cleanup();
		}
	});

	it("requires explicit enrollment", async () => {
		const h = await createHarness({ persistSession: true });
		try {
			const file = h.session.sessionFile;
			if (!file) throw new Error("missing session file");
			expect(existsSync(controlEndpointPath(file))).toBe(false);
			await expect(requestSessionControl(file, h.session.sessionId, "status")).rejects.toThrow();
		} finally {
			await h.session.close();
			h.cleanup();
		}
	});
});
