import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "omk-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness } from "./harness.ts";

afterEach(() => vi.unstubAllEnvs());

describe.skipIf(process.platform === "win32")("source quote memory runtime", () => {
	it.each([
		["0", "1"],
		["1", "0"],
	])("requires both recall and V2 opt-in (%s/%s)", async (memory, budget) => {
		vi.stubEnv("OMK_VERIFIED_MEMORY", memory);
		vi.stubEnv("OMK_CONTEXT_GOVERNOR", budget);
		const h = await createHarness({ persistSession: true });
		try {
			writeFileSync(join(h.tempDir, "facts.txt"), "Storage uses append-only events.");
			expect((await h.session.rememberSource({ path: "facts.txt", startLine: 1, endLine: 1 })).verdict).toBe(
				"accept",
			);
			const captured: string[] = [];
			h.setResponses([
				(context) => {
					captured.push(JSON.stringify(context));
					return fauxAssistantMessage("offline");
				},
			]);
			await h.session.prompt("Storage?");
			expect(captured).toHaveLength(1);
			expect(captured[0]).not.toContain("Storage uses append-only");
			expect(h.session.memoryStatus.state).toBe("disabled");
		} finally {
			await h.session.close();
			h.cleanup();
		}
	});

	it("revalidates memory between model requests in one prompt", async () => {
		vi.stubEnv("OMK_VERIFIED_MEMORY", "1");
		vi.stubEnv("OMK_CONTEXT_GOVERNOR", "1");
		let source = "";
		const h = await createHarness({
			persistSession: true,
			tools: [
				{
					name: "mutate",
					label: "mutate",
					description: "fixture mutation",
					parameters: Type.Object({}),
					execute: async () => {
						writeFileSync(source, "Changed source.");
						return { content: [{ type: "text", text: "updated" }], details: {} };
					},
				},
			],
		});
		try {
			source = join(h.tempDir, "facts.txt");
			writeFileSync(source, "Storage uses append-only events.");
			expect((await h.session.rememberSource({ path: "facts.txt", startLine: 1, endLine: 1 })).verdict).toBe(
				"accept",
			);
			const captured: string[] = [];
			h.setResponses([
				(context) => {
					captured.push(JSON.stringify(context));
					return fauxAssistantMessage(fauxToolCall("mutate", {}));
				},
				(context) => {
					captured.push(JSON.stringify(context));
					return fauxAssistantMessage("done");
				},
			]);
			await h.session.prompt("Change the Storage fixture.");
			expect(captured).toHaveLength(2);
			expect(captured[0]).toContain("Storage uses append-only");
			expect(captured[1]).not.toContain("Storage uses append-only");
		} finally {
			await h.session.close();
			h.cleanup();
		}
	});

	it("pins evidence, recalls as transient tool data, and removes it after source changes", async () => {
		vi.stubEnv("OMK_VERIFIED_MEMORY", "1");
		vi.stubEnv("OMK_CONTEXT_GOVERNOR", "1");
		const h = await createHarness({ persistSession: true });
		const observed: Context[] = [];
		const stream = h.session.agent.streamFn;
		h.session.agent.streamFn = (model, context, options) => {
			observed.push({ systemPrompt: context.systemPrompt, messages: structuredClone(context.messages) });
			return stream(model, context, options);
		};
		try {
			writeFileSync(join(h.tempDir, "architecture.txt"), "Storage uses append-only events.\n");
			const admitted = await h.session.rememberSource({ path: "architecture.txt", startLine: 1, endLine: 1 });
			expect(admitted.verdict).toBe("accept");
			h.setResponses([fauxAssistantMessage("fixture one"), fauxAssistantMessage("fixture two")]);
			await h.session.prompt("How does Storage retain events?");
			expect(h.session.memoryStatus, JSON.stringify(h.session.memoryStatus)).toMatchObject({ state: "ready" });
			const first = observed[0];
			expect(first.systemPrompt).not.toContain("Storage uses append-only");
			expect(
				first.messages
					.filter((m) => m.role === "user")
					.map((m) => JSON.stringify(m))
					.join(""),
			).not.toContain("Storage uses append-only");
			expect(
				first.messages.some(
					(m) => m.role === "toolResult" && JSON.stringify(m).includes("Storage uses append-only"),
				),
			).toBe(true);
			expect(JSON.stringify(h.session.messages)).not.toContain("Storage uses append-only");
			const file = h.session.sessionFile;
			if (!file) throw new Error("missing transcript");
			expect(readFileSync(file, "utf8")).not.toContain("Storage uses append-only");
			writeFileSync(join(h.tempDir, "architecture.txt"), "Storage now uses snapshots.\n");
			await h.session.prompt("How does Storage retain events now?");
			expect(JSON.stringify(observed[1])).not.toContain("Storage uses append-only");
		} finally {
			await h.session.close();
			h.cleanup();
		}
	});
});
