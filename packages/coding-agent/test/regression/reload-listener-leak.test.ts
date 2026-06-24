import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventBus } from "../../src/core/event-bus.ts";
import { DefaultResourceLoader } from "../../src/core/resource-loader.ts";

describe("reload event-bus listener leak (regression)", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `reload-listener-leak-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("does not stack duplicate omk.events listeners across reloads", async () => {
		const eventBus = createEventBus();
		let received = 0;
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			eventBus,
			extensionFactories: [
				(omk) => {
					omk.events.on("test-channel", () => {
						received++;
					});
				},
			],
		});

		await loader.reload();
		await loader.reload();
		await loader.reload();

		eventBus.emit("test-channel", {});

		// Without subscription cleanup, each reload re-runs the factory and
		// stacks another listener, so a single emit would fire 3 handlers.
		expect(received).toBe(1);
	});

	it("keeps listeners registered directly on an injected event bus across reloads", async () => {
		const eventBus = createEventBus();
		let external = 0;
		eventBus.on("external-channel", () => {
			external++;
		});

		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			eventBus,
			extensionFactories: [() => {}],
		});

		await loader.reload();
		await loader.reload();

		eventBus.emit("external-channel", {});

		// Cleanup must only remove extension API subscriptions, not listeners
		// the embedding application registered on its own bus.
		expect(external).toBe(1);
	});

	it("unsubscribe returned by omk.events.on still works and is idempotent across reload", async () => {
		const eventBus = createEventBus();
		let received = 0;
		let unsubscribe: (() => void) | undefined;
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			eventBus,
			extensionFactories: [
				(omk) => {
					unsubscribe = omk.events.on("manual-channel", () => {
						received++;
					});
				},
			],
		});

		await loader.reload();
		unsubscribe?.();
		eventBus.emit("manual-channel", {});
		expect(received).toBe(0);

		// Reload after a manual unsubscribe must not throw and the fresh
		// factory run subscribes exactly one new listener.
		await loader.reload();
		eventBus.emit("manual-channel", {});
		expect(received).toBe(1);
	});
});
