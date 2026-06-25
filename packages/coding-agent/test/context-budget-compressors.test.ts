import { describe, expect, it } from "vitest";
import {
	type CommandRunner,
	createCompressorRegistry,
	createHeadroomCliCompressor,
} from "../src/core/context-budget-compressors.ts";

function runner(result: { stdout?: string; exitCode?: number | null; timedOut?: boolean }): CommandRunner {
	return {
		async run(request) {
			if (request.args.includes("--version")) {
				return { exitCode: result.exitCode ?? 0, stdout: "version", stderr: "", timedOut: false };
			}
			return {
				exitCode: result.exitCode ?? 0,
				stdout: result.stdout ?? request.input.slice(0, 12),
				stderr: "",
				timedOut: result.timedOut ?? false,
			};
		},
	};
}

describe("context budget compressors", () => {
	it("compresses through a configured Headroom-compatible command runner", async () => {
		const compressor = createHeadroomCliCompressor({ runner: runner({ stdout: "compressed text" }) });
		const result = await compressor.compress({ text: "x".repeat(1000), targetTokens: 10, modelId: "unknown" });

		expect(result.method).toBe("compressed");
		expect(result.adapterId).toBe("headroom-cli");
		expect(result.text).toBe("compressed text");
		expect(result.output.tokens).toBeLessThan(result.input.tokens);
	});

	it("falls back to no compression when adapters are unavailable or fail", async () => {
		const unavailable = createHeadroomCliCompressor({ runner: runner({ exitCode: 127 }) });
		const registry = createCompressorRegistry([unavailable]);
		const result = await registry.compress({ text: "keep original", targetTokens: 1, modelId: "unknown" });

		expect(result.method).toBe("none");
		expect(result.text).toBe("keep original");
		expect(result.notes.join(" ")).toContain("unavailable");
	});

	it("does not replace context with empty compressor output", async () => {
		const compressor = createHeadroomCliCompressor({ runner: runner({ stdout: "" }) });
		const result = await compressor.compress({ text: "x".repeat(1000), targetTokens: 10, modelId: "unknown" });

		expect(result.method).toBe("none");
		expect(result.text).toBe("x".repeat(1000));
		expect(result.notes.join(" ")).toContain("empty-output");
	});
});
