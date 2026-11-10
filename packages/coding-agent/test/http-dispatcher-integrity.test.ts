import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dispatcherFetch } from "../src/core/http-dispatcher.ts";

const body = "OMK integrity regression fixture";
const url = `data:text/plain,${encodeURIComponent(body)}`;
const valid = createHash("sha256").update(body).digest("base64");
const mismatched = createHash("sha256").update(`${body} changed`).digest("base64");
const whitespace = [" ", "\t", "\n", "\r", "\f"];
const bunBinary = process.env.BUN_TEST_BINARY;

describe("the OMK dispatcher fetch integrity boundary", () => {
	it.each(whitespace)("accepts matching integrity surrounded by ASCII whitespace %j", async (separator) => {
		const response = await dispatcherFetch(url, { integrity: `${separator}sha256-${valid}${separator}` });
		expect(await response.text()).toBe(body);
	});

	it.each(whitespace)("rejects mismatched integrity surrounded by ASCII whitespace %j", async (separator) => {
		await expect(
			dispatcherFetch(url, { integrity: `${separator}sha256-${mismatched}${separator}` }),
		).rejects.toMatchObject({ cause: { message: "integrity mismatch" } });
	});

	it.skipIf(!bunBinary)("uses the integrity-checking npm implementation on Bun", () => {
		if (!bunBinary) throw new Error("BUN_TEST_BINARY is required");
		const source = new URL("../src/core/http-dispatcher.ts", import.meta.url).href;
		const script = `
			import assert from "node:assert/strict";
			import { dispatcherFetch } from ${JSON.stringify(source)};
			for (const separator of [" ", "\\t", "\\n", "\\r", "\\f"]) {
				const response = await dispatcherFetch(${JSON.stringify(url)}, {
					integrity: separator + ${JSON.stringify(`sha256-${valid}`)} + separator
				});
				assert.equal(await response.text(), ${JSON.stringify(body)});
				await assert.rejects(dispatcherFetch(${JSON.stringify(url)}, {
					integrity: separator + ${JSON.stringify(`sha256-${mismatched}`)} + separator
				}), error => error.cause?.message === "integrity mismatch");
			}
			console.log("integrity cases passed");
		`;
		const result = spawnSync(bunBinary, ["-e", script], {
			env: { PATH: process.env.PATH, HOME: process.env.HOME },
			encoding: "utf8",
			timeout: 10_000,
			maxBuffer: 16_384,
		});
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout.trim()).toBe("integrity cases passed");
	});
});
