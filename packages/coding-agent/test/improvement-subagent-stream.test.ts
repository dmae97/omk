import { afterEach, beforeEach, expect, it } from "vitest";
import { fixture, type ResultDetails } from "./improvement-subagent-fixture.ts";

let env: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
	env = await fixture();
});
afterEach(async () => {
	await env.cleanup();
});
it.each([
	"longline",
	"stderr-limit",
	"truncated",
	"events-limit",
	"messages-limit",
	"total-limit",
	"bad-usage",
	"duplicate-terminal",
	"empty",
])("rejects %s on the real handler path", async (task) => {
	const result = await env.execute({ agent: "fixture", task });
	expect(result.isError).toBe(true);
	const single = (result.details as ResultDetails).results[0];
	expect(single.errorMessage).toMatch(/subagent\.(output|stream)/);
	expect(single.messages.length).toBeLessThanOrEqual(1024);
	expect(Buffer.byteLength(single.stderr)).toBeLessThanOrEqual(256 * 1024);
	expect(single.process?.terminationObserved).toBe(true);
});
it("decodes UTF8 split between bytes without changing successful output", async () => {
	const result = await env.execute({ agent: "fixture", task: "unicode" });
	expect(result.isError).not.toBe(true);
	expect((result.details as ResultDetails).results[0].output).toBe("한글😀");
});
it("preserves process settlement when reporter throws", async () => {
	const result = await env.execute({ agent: "fixture", task: "report" }, undefined, () => {
		throw new Error("reporter");
	});
	expect(result.isError).toBe(true);
	const single = (result.details as ResultDetails).results[0];
	expect(single.process?.reason).toBe("callback-error");
	await expect(single.process?.settlement).resolves.toBeUndefined();
});
