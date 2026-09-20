/**
 * Browser session lifecycle — Jev audit F03 and algorithm A6 §12.5.
 *
 * Two audit reproductions drive this:
 *   R09 — `session_shutdown` read the still-empty slot while `getSession()`
 *         awaited `init()`. The init then completed and assigned the session,
 *         so a shut-down session came back to life.
 *   R10 — `stagehand_close` cleared the handle before `close()` resolved. When
 *         close threw, the handle was gone and the next call reported
 *         `closed: true` without ever closing the real browser.
 *
 * The fix both share is a generation-tagged state machine that never loses the
 * handle: a late init belonging to a superseded generation is discarded, and a
 * failed close keeps its handle in an explicit failure state.
 */

import { describe, expect, it } from "vitest";
import { SessionLifecycle, sequence } from "../src/coordination/index.ts";

describe("session lifecycle", () => {
	it("starts idle and opens a generation on init", () => {
		const session = new SessionLifecycle();
		expect(session.state).toBe("idle");
		const gen = session.beginInit();
		expect(session.state).toBe("initializing");
		expect(gen).toBe(sequence("1"));
	});

	it("completes init into ready and exposes the handle", () => {
		const session = new SessionLifecycle();
		const gen = session.beginInit();
		expect(session.completeInit(gen, { id: "browser-1" })).toBe(true);
		expect(session.state).toBe("ready");
		expect(session.handle).toEqual({ id: "browser-1" });
	});

	it("discards a late init from a superseded generation (F03 / R09)", () => {
		const session = new SessionLifecycle();
		const stale = session.beginInit();
		// Shutdown arrives while init is still in flight.
		session.requestShutdown();
		expect(session.state).toBe("closed");

		// The in-flight init now resolves. It must not resurrect the session.
		expect(session.completeInit(stale, { id: "browser-1" })).toBe(false);
		expect(session.state).toBe("closed");
		expect(session.handle).toBeUndefined();
		expect(session.discardedHandles).toEqual([{ id: "browser-1" }]);
	});

	it("keeps the handle when close fails (F03 / R10)", () => {
		const session = new SessionLifecycle();
		const gen = session.beginInit();
		session.completeInit(gen, { id: "browser-1" });
		session.beginClose();
		expect(session.state).toBe("draining");

		session.failClose(new Error("target closed unexpectedly"));
		expect(session.state).toBe("close-failed");
		expect(session.handle).toEqual({ id: "browser-1" });
		expect(session.closeFailure?.message).toMatch(/target closed/);
	});

	it("does not report a failed close as closed", () => {
		const session = new SessionLifecycle();
		const gen = session.beginInit();
		session.completeInit(gen, { id: "browser-1" });
		session.beginClose();
		session.failClose(new Error("boom"));
		expect(session.isClosed).toBe(false);
	});

	it("lets a retried close succeed and only then releases the handle", () => {
		const session = new SessionLifecycle();
		const gen = session.beginInit();
		session.completeInit(gen, { id: "browser-1" });
		session.beginClose();
		session.failClose(new Error("boom"));

		session.beginClose();
		session.completeClose();
		expect(session.state).toBe("closed");
		expect(session.handle).toBeUndefined();
		expect(session.isClosed).toBe(true);
	});

	it("refuses to open a new generation while a close failure is unresolved", () => {
		const session = new SessionLifecycle();
		const gen = session.beginInit();
		session.completeInit(gen, { id: "browser-1" });
		session.beginClose();
		session.failClose(new Error("boom"));
		expect(() => session.beginInit()).toThrow(/close-failed|unresolved/i);
	});

	it("records init failure without claiming a usable session", () => {
		const session = new SessionLifecycle();
		const gen = session.beginInit();
		session.failInit(gen, new Error("launch refused"));
		expect(session.state).toBe("idle");
		expect(session.handle).toBeUndefined();
	});

	it("fences a command carrying a superseded generation", () => {
		const session = new SessionLifecycle();
		const first = session.beginInit();
		session.completeInit(first, { id: "browser-1" });
		expect(session.accepts(first)).toBe(true);

		session.beginClose();
		session.completeClose();
		const second = session.beginInit();
		session.completeInit(second, { id: "browser-2" });

		expect(session.accepts(first)).toBe(false);
		expect(session.accepts(second)).toBe(true);
	});

	it("accepts no command unless the session is ready", () => {
		const session = new SessionLifecycle();
		const gen = session.beginInit();
		expect(session.accepts(gen)).toBe(false);
		session.completeInit(gen, { id: "browser-1" });
		expect(session.accepts(gen)).toBe(true);
		session.beginClose();
		expect(session.accepts(gen)).toBe(false);
	});

	it("monotonically increases the generation across restarts", () => {
		const session = new SessionLifecycle();
		const first = session.beginInit();
		session.completeInit(first, { id: "b1" });
		session.beginClose();
		session.completeClose();
		const second = session.beginInit();
		expect(BigInt(second) > BigInt(first)).toBe(true);
	});

	it("treats shutdown during draining as reaching closed once complete", () => {
		const session = new SessionLifecycle();
		const gen = session.beginInit();
		session.completeInit(gen, { id: "b1" });
		session.beginClose();
		session.requestShutdown();
		expect(session.state).toBe("draining");
		session.completeClose();
		expect(session.state).toBe("closed");
	});

	it("rejects a completeInit for a generation that was never opened", () => {
		const session = new SessionLifecycle();
		session.beginInit();
		expect(session.completeInit(sequence("99"), { id: "ghost" })).toBe(false);
	});
});
