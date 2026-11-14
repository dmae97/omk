import { describe, expect, it } from "vitest";
import { tryAcquireLaneDispatch } from "../src/core/lane-dispatch-ownership.ts";

describe("tryAcquireLaneDispatch", () => {
	it("hands out one lease per pool", () => {
		const pool = {};
		const release = tryAcquireLaneDispatch(pool);
		expect(typeof release).toBe("function");
		expect(tryAcquireLaneDispatch(pool)).toBeUndefined();
	});

	it("lets a different pool acquire independently", () => {
		const first = tryAcquireLaneDispatch({});
		const second = tryAcquireLaneDispatch({});
		expect(typeof first).toBe("function");
		expect(typeof second).toBe("function");
	});

	it("frees the pool after the release is called", () => {
		const pool = {};
		const release = tryAcquireLaneDispatch(pool);
		release?.();
		expect(typeof tryAcquireLaneDispatch(pool)).toBe("function");
	});

	it("does not let a stale release free a new lease", () => {
		const pool = {};
		const first = tryAcquireLaneDispatch(pool);
		expect(tryAcquireLaneDispatch(pool)).toBeUndefined();
		first?.();
		const reacquired = tryAcquireLaneDispatch(pool);
		expect(typeof reacquired).toBe("function");
		first?.();
		expect(tryAcquireLaneDispatch(pool)).toBeUndefined();
		reacquired?.();
		expect(typeof tryAcquireLaneDispatch(pool)).toBe("function");
	});

	it("tolerates calling the same release twice", () => {
		const pool = {};
		const release = tryAcquireLaneDispatch(pool);
		release?.();
		release?.();
		expect(typeof tryAcquireLaneDispatch(pool)).toBe("function");
	});
});
