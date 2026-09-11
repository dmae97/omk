import { describe, expect, it } from "vitest";
import { parseRunContract } from "../src/index.ts";

function task(id: string, dependsOn: string[] = []) {
	return { id, dependsOn, writablePaths: [id], attempts: [["/bin/true"]] };
}
function input() {
	return {
		schemaVersion: "omk.verified-run.v1",
		profile: "linux-command-dag-v1",
		runId: "dag",
		goal: "Join two isolated outputs",
		workspace: { root: "/workspace", baseDigest: "a".repeat(64) },
		writablePaths: ["left", "right", "joined"],
		writer: { kind: "command-dag", tasks: [task("joined", ["left", "right"]), task("left"), task("right")] },
		checks: [{ claimId: "joined", argv: ["/bin/true"], stdout: "" }],
		budget: { workMs: 1000, verifyMs: 1000, cleanupMs: 1000, maxOutputBytes: 1024, maxFiles: 100, maxBytes: 4096 },
		apply: "artifact-only",
	};
}

describe("bounded command DAG contract", () => {
	it("accepts forward dependency references and snapshots all nested task inputs", () => {
		const raw = input();
		const parsed = parseRunContract(raw);
		const snapshot = JSON.stringify(parsed);
		raw.writer.tasks[0].dependsOn.push("unknown");
		raw.writer.tasks[1].attempts[0].push("changed");
		expect(JSON.stringify(parsed)).toBe(snapshot);
		expect(Object.isFrozen(parsed.writer)).toBe(true);
	});

	it("accepts two separately approved attempts without a live model backend", () => {
		const raw = input();
		raw.writer.tasks[1].attempts.push(["/bin/echo", "repair"]);
		expect(parseRunContract(raw).profile).toBe("linux-command-dag-v1");
	});

	it.each(
		[
			[],
			[task("left"), task("left")],
			[task("left", ["missing"])],
			[task("left", ["left"])],
			[task("left", ["right"]), task("right", ["left"])],
			[task("left", ["right", "right"]), task("right")],
			Array.from({ length: 17 }, (_, i) => task(`t${i}`)),
		].map((tasks) => ({ tasks })),
	)("rejects an invalid dependency graph %# before any execution", ({ tasks }) => {
		expect(() => parseRunContract({ ...input(), writer: { kind: "command-dag", tasks } })).toThrow();
	});

	it.each([[], [["relative"]], [["/bin/true"], ["/bin/true"], ["/bin/true"]]].map((attempts) => ({ attempts })))(
		"rejects an invalid attempt sequence %#",
		({ attempts }) => {
			const raw = input();
			raw.writer.tasks[0].attempts = attempts;
			expect(() => parseRunContract(raw)).toThrow();
		},
	);

	it.each([["outside"], ["left"], ["left/child"], ["../left"]].map((paths) => ({ paths })))(
		"rejects overlapping or unapproved output scopes %#",
		({ paths }) => {
			const raw = input();
			raw.writer.tasks[2].writablePaths = paths;
			expect(() => parseRunContract(raw)).toThrow();
		},
	);

	it("does not interpret extra fields or getters as task authority", () => {
		const raw = input();
		const getter = {
			...task("left"),
			get attempts() {
				throw new Error("getter executed");
			},
		};
		expect(() => parseRunContract({ ...raw, writer: { kind: "command-dag", tasks: [getter] } })).toThrow(/Invalid/);
		expect(() => parseRunContract({ ...raw, writer: { ...raw.writer, trusted: true } })).toThrow();
	});
});
