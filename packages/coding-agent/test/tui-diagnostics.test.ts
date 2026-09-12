import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "omk-tui";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { redactSensitiveText } from "../src/core/redaction.ts";
import { classifySessionTermination } from "../src/core/session-termination.ts";
import { SessionFailureComponent } from "../src/modes/interactive/components/session-failure.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import {
	createTuiDiagnostics,
	createTuiDiagnosticsView,
	saveTuiDiagnostics,
} from "../src/modes/interactive/tui-diagnostics.ts";
import { captureTuiRuntime, inspectTuiRuntime } from "../src/modes/interactive/tui-runtime-info.ts";

vi.hoisted(() => {
	vi.stubEnv("PI_DISABLE_INPUT_REDACTION", "1");
});
afterAll(() => vi.unstubAllEnvs());
const roots: string[] = [];
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "omk-tui-diagnostics-"));
	roots.push(root);
	const modulePath = join(root, "src/modes/interactive/interactive-mode.ts");
	mkdirSync(dirname(modulePath), { recursive: true });
	writeFileSync(modulePath, "export const revision = 1;");
	return { root, modulePath, runtime: captureTuiRuntime(pathToFileURL(modulePath).href) };
}
const termination = classifySessionTermination({
	sessionId: "private-session",
	runId: "private-run",
	timestamp: "2026-09-12T00:00:00.000Z",
	source: "observed",
	cause: { area: "tool", code: "timeout" },
	sideEffects: "possible",
	message: "Private message",
	toolName: "private-tool",
	provider: "private-provider",
	model: "private-model",
});
function report(runtime: ReturnType<typeof captureTuiRuntime>) {
	return createTuiDiagnostics({
		runtime: inspectTuiRuntime(runtime),
		columns: 80,
		rows: 24,
		isStreaming: false,
		isCompacting: false,
		messageCount: 5,
		termination,
		lastResourceReloadAt: undefined,
	});
}
beforeAll(() => initTheme("dark"));
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runtime identity observations", () => {
	it("pins initialization identity and detects a later on-disk change without claiming a build revision", () => {
		const { modulePath, runtime } = fixture();
		const first = inspectTuiRuntime(runtime);
		expect(first.moduleKind).toBe("source");
		expect(first.moduleState).toBe("unchanged");
		expect(first.buildRevision).toBeNull();
		writeFileSync(modulePath, "export const revision = 2;");
		const next = inspectTuiRuntime(runtime);
		expect(next.moduleState).toBe("changed");
		expect(next.initialModuleSha256).toBe(first.initialModuleSha256);
		expect(next.currentModuleSha256).not.toBe(first.currentModuleSha256);
	});
	it("reports a missing module as unconfirmed, not clean", () => {
		const { modulePath, runtime } = fixture();
		rmSync(modulePath);
		expect(inspectTuiRuntime(runtime).moduleState).toBe("unavailable");
	});
	it("bounds inspection and does not hash directories", () => {
		const { root, modulePath } = fixture();
		writeFileSync(modulePath, Buffer.alloc(1_048_577));
		expect(inspectTuiRuntime(captureTuiRuntime(pathToFileURL(modulePath).href)).moduleState).toBe("unavailable");
		expect(inspectTuiRuntime(captureTuiRuntime(pathToFileURL(root).href)).moduleState).toBe("unavailable");
	});
	it("keeps virtual/bundled entries usable without a filesystem fingerprint", () => {
		const observed = inspectTuiRuntime(captureTuiRuntime("bun:virtual-entry"));
		expect(observed.moduleState).toBe("unavailable");
		expect(observed.buildRevision).toBeNull();
	});
});

describe("metadata-only diagnostics", () => {
	it("omits free text, local paths, routing names, run/session ids and unknown fields", () => {
		const { runtime, root } = fixture();
		const data = report(runtime);
		const serialized = JSON.stringify(data);
		for (const secret of [
			root,
			"Private message",
			"private-session",
			"private-run",
			"private-tool",
			"private-provider",
			"private-model",
		]) {
			expect(serialized).not.toContain(secret);
		}
		expect(data.termination?.kind).toBe("tool_timeout");
		expect(data.termination?.sideEffects).toBe("possible");
		expect(data.privacy).toBe("metadata-only");
	});
	it("saves a new owner-only report, never overwriting an existing file", () => {
		const { runtime, root } = fixture();
		const data = report(runtime);
		const first = saveTuiDiagnostics(data, root);
		const second = saveTuiDiagnostics(data, root);
		expect(second).not.toBe(first);
		expect(JSON.parse(readFileSync(first, "utf8"))).toEqual(data);
		if (process.platform !== "win32") {
			expect(statSync(first).mode & 0o777).toBe(0o600);
			expect(statSync(dirname(first)).mode & 0o777).toBe(0o700);
		}
	});
});

describe("diagnostic view", () => {
	it("refreshes themed content when invalidated and keeps the same metadata", () => {
		const { runtime } = fixture();
		const data = report(runtime);
		const view = createTuiDiagnosticsView(data, runtime);
		initTheme("dark");
		const dark = view.render(80).join("\n");
		initTheme("light");
		view.invalidate();
		const light = view.render(80).join("\n");
		expect(stripVTControlCharacters(light)).toBe(stripVTControlCharacters(dark));
		expect(light).not.toBe(dark);
		expect(light).toBe(createTuiDiagnosticsView(data, runtime).render(80).join("\n"));
		initTheme("dark");
	});
});

describe("failure cards", () => {
	it("expands technical detail without replaying work or changing retry semantics", () => {
		const card = new SessionFailureComponent(termination);
		const text = () => stripVTControlCharacters(card.render(100).join("\n"));
		expect(text()).toContain("Impact:");
		expect(text()).not.toContain("private-run");
		card.setExpanded(true);
		expect(text()).toContain("private-run");
		expect(text()).toContain("Automatic retry: no");
		expect(text()).toContain("possible");
		card.setExpanded(false);
		expect(text()).not.toContain("private-run");
	});
	it("masks credentials even with interactive redaction disabled and removes terminal controls", () => {
		const token = `sk-${"F".repeat(24)}`;
		expect(redactSensitiveText(token)).toBe(token);
		const card = new SessionFailureComponent({
			...termination,
			message: `Bad ${token}\u001b]52;c;CANARY\u0007\u0008한글`,
			nextAction: `token=${token}`,
		});
		card.setExpanded(true);
		const text = stripVTControlCharacters(card.render(100).join("\n"));
		expect(text).toContain("[REDACTED]");
		expect(text).toContain("한글");
		expect(text).not.toContain(token);
		expect(text).not.toContain("CANARY");
		expect(text).not.toContain("\u0008");
	});
	it.each([20, 40, 80, 120])("fits %i columns before and after expansion/theme invalidation", (width) => {
		const card = new SessionFailureComponent({ ...termination, message: "한글🙂".repeat(60) });
		for (const expanded of [false, true]) {
			card.setExpanded(expanded);
			card.invalidate();
			expect(card.render(width).every((line) => visibleWidth(line) <= width)).toBe(true);
		}
	});
});
