import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	canonicalJson,
	createHarnessControlEvent,
	hashCanonical,
	recordHarnessControlEvent,
	sanitizeHarnessControlEventData,
	verifyHarnessControlLedger,
} from "../src/core/harness-control-events.ts";

describe("harness control event ledger", () => {
	const tempDirs: string[] = [];
	const previousEventLog = process.env.OMK_HARNESS_CONTROL_EVENT_LOG;
	const previousEventsEnabled = process.env.OMK_HARNESS_CONTROL_EVENTS;

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		if (previousEventLog === undefined) {
			delete process.env.OMK_HARNESS_CONTROL_EVENT_LOG;
		} else {
			process.env.OMK_HARNESS_CONTROL_EVENT_LOG = previousEventLog;
		}
		if (previousEventsEnabled === undefined) {
			delete process.env.OMK_HARNESS_CONTROL_EVENTS;
		} else {
			process.env.OMK_HARNESS_CONTROL_EVENTS = previousEventsEnabled;
		}
	});

	function createTempDir(): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omk-harness-events-"));
		tempDirs.push(dir);
		return dir;
	}

	it("writes V2 JSONL events with deterministic audit fields and hash chain", () => {
		const root = createTempDir();
		const logPath = path.join(root, "events.jsonl");

		const first = recordHarnessControlEvent(
			"extension.migration.plan",
			"started",
			{ actions: 1 },
			{
				cwd: root,
				logPath,
				eventId: "event-1",
				runId: "run-1",
				sessionId: "session-1",
				operationId: "op-1",
				now: new Date("2026-06-18T00:00:00Z"),
			},
		);
		const second = recordHarnessControlEvent(
			"extension.migration.plan",
			"completed",
			{ actions: 1 },
			{
				cwd: root,
				logPath,
				eventId: "event-2",
				runId: "run-1",
				sessionId: "session-1",
				operationId: "op-1",
				causationId: "event-1",
				now: new Date("2026-06-18T00:00:01Z"),
			},
		);

		expect(first.ok).toBe(true);
		expect(second.ok).toBe(true);
		const lines = fs.readFileSync(logPath, "utf-8").trim().split("\n");
		expect(lines).toHaveLength(2);
		const firstEvent = JSON.parse(lines[0]!);
		const secondEvent = JSON.parse(lines[1]!);
		expect(firstEvent).toMatchObject({
			schemaVersion: "omk.harness-control.event.v2",
			eventId: "event-1",
			runId: "run-1",
			sessionId: "session-1",
			operationId: "op-1",
			sequence: 1,
			previousEventHash: "0".repeat(64),
			data: { actions: 1 },
		});
		expect(secondEvent).toMatchObject({ sequence: 2, previousEventHash: firstEvent.eventHash });
		expect(verifyHarnessControlLedger(logPath)).toMatchObject({ ok: true, errors: [] });
	});

	it("redacts sensitive event data by key and value before persistence", () => {
		const data = sanitizeHarnessControlEventData({
			apiKey: "secret-value",
			message: "Authorization: Bearer abc.def.ghi and sk-proj-abcdefghijklmnop",
			nested: { authorization: "Bearer token", safe: "kept" },
		});

		expect(data).toEqual({
			apiKey: "[redacted]",
			message: "Authorization: Bearer [redacted] and [redacted]",
			nested: { authorization: "[redacted]", safe: "kept" },
		});
	});

	it("canonicalizes JSON before hashing", () => {
		expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
		expect(hashCanonical({ b: 2, a: 1 })).toBe(hashCanonical({ a: 1, b: 2 }));
	});

	it("can create events without writing when callers need dry-run data", () => {
		const event = createHarnessControlEvent(
			"interactive.theme.apply",
			"failed",
			{ themeName: "missing" },
			{
				cwd: "/tmp/project",
				eventId: "event-2",
				runId: "run-1",
				sessionId: "session-1",
				operationId: "op-2",
				now: new Date("2026-06-18T01:00:00Z"),
			},
		);

		expect(event).toMatchObject({
			eventId: "event-2",
			kind: "interactive.theme.apply",
			status: "failed",
			cwd: "/tmp/project",
			data: { themeName: "missing" },
		});
		expect(event.eventHash).toMatch(/^[a-f0-9]{64}$/);
	});

	it("does not remove an existing lock when append acquisition fails", () => {
		const root = createTempDir();
		const logPath = path.join(root, "events.jsonl");
		const lockPath = `${logPath}.lock`;
		fs.mkdirSync(path.dirname(logPath), { recursive: true });
		fs.writeFileSync(lockPath, "other-writer", "utf-8");

		const result = recordHarnessControlEvent(
			"spec.compile",
			"completed",
			{},
			{ cwd: root, logPath, lockTimeoutMs: 0 },
		);

		expect(result.ok).toBe(false);
		expect(fs.existsSync(lockPath)).toBe(true);
	});

	it("detects tampering in persisted events", () => {
		const root = createTempDir();
		const logPath = path.join(root, "events.jsonl");
		recordHarnessControlEvent("spec.compile", "completed", { actions: 1 }, { cwd: root, logPath });
		const tampered = fs.readFileSync(logPath, "utf-8").replace("actions", "changedActions");
		fs.writeFileSync(logPath, tampered, "utf-8");

		const result = verifyHarnessControlLedger(logPath);

		expect(result.ok).toBe(false);
		expect(result.errors.join("\n")).toContain("hash mismatch");
	});

	it("rotates oversized ledgers under the append lock", () => {
		const root = createTempDir();
		const logPath = path.join(root, "events.jsonl");
		recordHarnessControlEvent("spec.compile", "completed", { large: "x".repeat(120) }, { cwd: root, logPath });

		const second = recordHarnessControlEvent(
			"spec.compile",
			"completed",
			{},
			{
				cwd: root,
				logPath,
				maxLedgerBytes: 20,
				now: new Date("2026-06-18T02:00:00Z"),
			},
		);

		expect(second.ok).toBe(true);
		expect(fs.existsSync(`${logPath}.2026-06-18T02-00-00-000Z.rotated`)).toBe(true);
		expect(verifyHarnessControlLedger(logPath)).toMatchObject({ ok: true });
	});

	it("hashes allowed artifact references and blocks sensitive paths", () => {
		const root = createTempDir();
		const artifact = path.join(root, "artifact.txt");
		const secret = path.join(root, ".env");
		fs.writeFileSync(artifact, "artifact", "utf-8");
		fs.writeFileSync(secret, "TOKEN=secret", "utf-8");

		const event = createHarnessControlEvent(
			"spec.compile",
			"completed",
			{},
			{ cwd: root, artifactRefs: ["artifact.txt", ".env"] },
		);

		expect(event.artifacts).toContainEqual(
			expect.objectContaining({ path: "artifact.txt", exists: true, allowed: true, sha256: expect.any(String) }),
		);
		expect(event.artifacts).toContainEqual(expect.objectContaining({ path: ".env", exists: true, allowed: false }));
	});
});
