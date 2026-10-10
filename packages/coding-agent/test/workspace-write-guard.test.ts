/**
 * The write and edit tools must not leave the workspace.
 *
 * Before this guard an agent session could write anywhere the user can, for
 * example `../../.bashrc` or `~/.ssh/authorized_keys`, and a symlink committed
 * inside a repo could redirect a "workspace" write to any file on disk. The
 * boundary is checked on the canonical path (after `..` and symlinks), and the
 * escape hatch is read from global settings only so a cloned repo cannot turn
 * it off through its own `.omk/settings.json`.
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "omk-agent-core";
import { getModel } from "omk-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createEditToolDefinition, createWriteToolDefinition } from "../src/core/tools/index.ts";
import { canonicalizeForWrite, createWorkspaceWriteGuard } from "../src/core/tools/workspace-write-guard.ts";
import { createTestResourceLoader } from "./utilities.ts";

let base: string;
let workspace: string;
let outside: string;

beforeEach(() => {
	base = realpathSync(mkdtempSync(join(tmpdir(), "omk-write-guard-")));
	workspace = join(base, "ws");
	outside = join(base, "outside");
	mkdirSync(join(workspace, "src"), { recursive: true });
	mkdirSync(outside, { recursive: true });
	writeFileSync(join(workspace, "src", "a.txt"), "inside");
	writeFileSync(join(outside, "victim.txt"), "untouched");
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true });
});

const ctx = () => ({ cwd: workspace, hasUI: false, model: undefined }) as unknown as ExtensionContext;

describe("createWorkspaceWriteGuard", () => {
	it("allows the root, existing files, and new files in new subdirectories", () => {
		const guard = createWorkspaceWriteGuard([workspace]);
		expect(guard(workspace).allowed).toBe(true);
		expect(guard(join(workspace, "src", "a.txt")).allowed).toBe(true);
		expect(guard(join(workspace, "new", "deep", "file.ts")).allowed).toBe(true);
	});

	it("refuses `..` escapes and absolute paths outside", () => {
		const guard = createWorkspaceWriteGuard([workspace]);
		expect(guard(join(workspace, "..", "outside", "victim.txt")).allowed).toBe(false);
		expect(guard(join(outside, "victim.txt")).allowed).toBe(false);
	});

	it("does not treat a sibling with the same prefix as inside", () => {
		mkdirSync(`${workspace}-evil`);
		const guard = createWorkspaceWriteGuard([workspace]);
		expect(guard(join(`${workspace}-evil`, "x.txt")).allowed).toBe(false);
	});

	it("follows a symlinked directory that points outside", () => {
		symlinkSync(outside, join(workspace, "link-out"), "dir");
		const guard = createWorkspaceWriteGuard([workspace]);
		const decision = guard(join(workspace, "link-out", "victim.txt"));
		expect(decision.allowed).toBe(false);
		if (!decision.allowed) expect(decision.reason).toContain(join(outside, "victim.txt"));
		// A new file under the escaping link is outside too.
		expect(guard(join(workspace, "link-out", "new", "file.txt")).allowed).toBe(false);
	});

	it("follows a symlinked file that points outside", () => {
		symlinkSync(join(outside, "victim.txt"), join(workspace, "innocent.txt"));
		const guard = createWorkspaceWriteGuard([workspace]);
		expect(guard(join(workspace, "innocent.txt")).allowed).toBe(false);
	});

	it("allows a symlink that stays inside the workspace", () => {
		symlinkSync(join(workspace, "src"), join(workspace, "src-alias"), "dir");
		const guard = createWorkspaceWriteGuard([workspace]);
		expect(guard(join(workspace, "src-alias", "a.txt")).allowed).toBe(true);
	});

	it("accepts a workspace root that is itself reached through a symlink", () => {
		const alias = join(base, "ws-alias");
		symlinkSync(workspace, alias, "dir");
		const guard = createWorkspaceWriteGuard([alias]);
		expect(guard(join(workspace, "src", "a.txt")).allowed).toBe(true);
		expect(guard(join(alias, "src", "a.txt")).allowed).toBe(true);
	});

	it("does not resolve a dangling symlink as if its target were inside", () => {
		symlinkSync(join(outside, "not-yet.txt"), join(workspace, "dangling.txt"));
		const guard = createWorkspaceWriteGuard([workspace]);
		// Writing through it would create outside/not-yet.txt.
		expect(canonicalizeForWrite(join(workspace, "dangling.txt"))).toBe(join(outside, "not-yet.txt"));
		expect(guard(join(workspace, "dangling.txt")).allowed).toBe(false);
	});

	it("treats a symlink loop as unresolvable instead of hanging", () => {
		symlinkSync(join(workspace, "loop-b"), join(workspace, "loop-a"));
		symlinkSync(join(workspace, "loop-a"), join(workspace, "loop-b"));
		const guard = createWorkspaceWriteGuard([workspace]);
		expect(typeof guard(join(workspace, "loop-a")).allowed).toBe("boolean");
	});

	it("honours extra roots", () => {
		const guard = createWorkspaceWriteGuard([workspace, outside]);
		expect(guard(join(outside, "victim.txt")).allowed).toBe(true);
	});
});

describe("write and edit tools with workspaceRoots", () => {
	it("write refuses an escape and leaves the target untouched", async () => {
		const write = createWriteToolDefinition(workspace, { workspaceRoots: [workspace] });
		await expect(
			write.execute("w1", { path: "../outside/victim.txt", content: "pwned" }, undefined, undefined, ctx()),
		).rejects.toThrow(/Write blocked: \.\.\/outside\/victim\.txt resolves to .*outside the workspace/);
		expect(readFileSync(join(outside, "victim.txt"), "utf8")).toBe("untouched");
	});

	it("write refuses a new directory outside and does not create it", async () => {
		const write = createWriteToolDefinition(workspace, { workspaceRoots: [workspace] });
		await expect(
			write.execute("w2", { path: join(outside, "made", "x.txt"), content: "x" }, undefined, undefined, ctx()),
		).rejects.toThrow(/Write blocked/);
		expect(existsSync(join(outside, "made"))).toBe(false);
	});

	it("edit refuses a symlink that points outside", async () => {
		symlinkSync(join(outside, "victim.txt"), join(workspace, "innocent.txt"));
		const edit = createEditToolDefinition(workspace, { workspaceRoots: [workspace] });
		await expect(
			edit.execute(
				"e1",
				{ path: "innocent.txt", edits: [{ oldText: "untouched", newText: "pwned" }] },
				undefined,
				undefined,
				ctx(),
			),
		).rejects.toThrow(/Edit blocked: innocent\.txt resolves to/);
		expect(readFileSync(join(outside, "victim.txt"), "utf8")).toBe("untouched");
	});

	it("write and edit still work inside the workspace", async () => {
		const write = createWriteToolDefinition(workspace, { workspaceRoots: [workspace] });
		const edit = createEditToolDefinition(workspace, { workspaceRoots: [workspace] });
		await write.execute("w3", { path: "new/dir/b.txt", content: "hello" }, undefined, undefined, ctx());
		await edit.execute(
			"e2",
			{ path: "src/a.txt", edits: [{ oldText: "inside", newText: "edited" }] },
			undefined,
			undefined,
			ctx(),
		);
		expect(readFileSync(join(workspace, "new", "dir", "b.txt"), "utf8")).toBe("hello");
		expect(readFileSync(join(workspace, "src", "a.txt"), "utf8")).toBe("edited");
	});

	it("without workspaceRoots the SDK factory keeps its old unrestricted behaviour", async () => {
		const write = createWriteToolDefinition(workspace);
		await write.execute("w4", { path: "../outside/sdk.txt", content: "ok" }, undefined, undefined, ctx());
		expect(readFileSync(join(outside, "sdk.txt"), "utf8")).toBe("ok");
	});
});

describe("agent session wiring", () => {
	let agentDir: string;
	let session: AgentSession | undefined;

	beforeEach(() => {
		agentDir = join(base, "agent");
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		session?.dispose();
		session = undefined;
	});

	function writeSettings(path: string, value: unknown) {
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, JSON.stringify(value));
	}

	function startSession(): AgentSession {
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model: getModel("anthropic", "claude-sonnet-5"), systemPrompt: "x", tools: [] },
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.create(workspace, agentDir),
			cwd: workspace,
			modelRegistry: ModelRegistry.create(AuthStorage.create(join(agentDir, "auth.json"))),
			resourceLoader: createTestResourceLoader(),
		});
		return session;
	}

	async function sessionWrite(s: AgentSession, path: string, content: string) {
		const write = s.getToolDefinition("write");
		if (!write) throw new Error("write tool missing from session");
		return write.execute("s1", { path, content }, undefined, undefined, ctx());
	}

	it("blocks writes outside the session cwd by default", async () => {
		const s = startSession();
		await expect(sessionWrite(s, "../outside/victim.txt", "pwned")).rejects.toThrow(/Write blocked/);
		expect(readFileSync(join(outside, "victim.txt"), "utf8")).toBe("untouched");
		await sessionWrite(s, "src/ok.txt", "fine");
		expect(readFileSync(join(workspace, "src", "ok.txt"), "utf8")).toBe("fine");
	});

	it("allows a directory listed in global fileTools.writeRoots", async () => {
		writeSettings(join(agentDir, "settings.json"), { fileTools: { writeRoots: [outside] } });
		const s = startSession();
		await sessionWrite(s, "../outside/victim.txt", "allowed");
		expect(readFileSync(join(outside, "victim.txt"), "utf8")).toBe("allowed");
	});

	it("ignores fileTools in project settings, so a repo cannot widen its own reach", async () => {
		writeSettings(join(workspace, ".omk", "settings.json"), {
			fileTools: { writeRoots: [outside], allowWriteOutsideWorkspace: true },
		});
		const s = startSession();
		await expect(sessionWrite(s, "../outside/victim.txt", "pwned")).rejects.toThrow(/Write blocked/);
		expect(readFileSync(join(outside, "victim.txt"), "utf8")).toBe("untouched");
	});

	it("global allowWriteOutsideWorkspace turns the boundary off", async () => {
		writeSettings(join(agentDir, "settings.json"), { fileTools: { allowWriteOutsideWorkspace: true } });
		const s = startSession();
		await sessionWrite(s, "../outside/victim.txt", "opted-out");
		expect(readFileSync(join(outside, "victim.txt"), "utf8")).toBe("opted-out");
	});
});
