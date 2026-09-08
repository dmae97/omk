import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInitCli } from "../src/commands/init-cli.ts";
import { loadProjectContextFiles } from "../src/core/resource-loader.ts";

const templatesDir = fileURLToPath(new URL("../examples/context", import.meta.url));
let root: string;
let agentDir: string;
let lines: string[];

function initialize(args = ["init", "--global"]) {
	return runInitCli(args, { agentDir, templatesDir, writeLine: (line) => lines.push(line) });
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "omk-context-init-"));
	agentDir = join(root, "agent");
	lines = [];
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("user context initialization", () => {
	it("leaves unrelated CLI arguments unhandled", () => {
		// Given a normal model prompt, when dispatching it to setup.
		const outcome = initialize(["--print", "explain init"]);
		// Then it remains available to the normal CLI without file I/O.
		expect(outcome).toEqual({ handled: false, exitCode: 0 });
		expect(readdirSync(root)).toEqual([]);
		expect(lines).toEqual([]);
	});

	it("prints help without touching the config", () => {
		// Given no config directory, when asking for help.
		const outcome = initialize(["init", "--help"]);
		// Then help succeeds without creating directories.
		expect(outcome).toEqual({ handled: true, exitCode: 0 });
		expect(lines.join("\n")).toContain("Usage: omk init --global");
		expect(readdirSync(root)).toEqual([]);
	});

	it.each([{ args: ["init"] }, { args: ["init", "--force"] }])("rejects unsupported invocation $args", ({ args }) => {
		// Given unsupported arguments, when dispatching setup directly.
		const outcome = initialize(args);
		// Then no setup work is performed.
		expect(outcome.exitCode).toBe(2);
		expect(readdirSync(root)).toEqual([]);
	});

	it("previews all templates without creating a directory", () => {
		// Given a missing config, when previewing setup directly.
		const outcome = initialize(["init", "--global", "--dry-run"]);
		// Then every template is previewed without writes.
		expect(outcome.exitCode).toBe(0);
		expect(lines.filter((line) => line.startsWith("Would create:"))).toHaveLength(3);
		expect(readdirSync(root)).toEqual([]);
	});

	it("preserves a file created concurrently after planning", () => {
		// Given another writer creates INTERNET.md after the first setup file.
		const outcome = runInitCli(["init", "--global"], {
			agentDir,
			templatesDir,
			writeLine: (line) => {
				lines.push(line);
				if (line.startsWith("Created:") && line.includes("AGENTS.md")) {
					writeFileSync(join(agentDir, "INTERNET.md"), "# Concurrent policy\n");
				}
			},
		});
		// When creation meets that file, then the concurrent bytes survive.
		expect(outcome.exitCode).toBe(0);
		expect(readFileSync(join(agentDir, "INTERNET.md"), "utf8")).toBe("# Concurrent policy\n");
		expect(lines.some((line) => line.startsWith("Preserved concurrent file:"))).toBe(true);
	});

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("reports write permission failures", () => {
		// Given a non-writable destination owned by the current user.
		mkdirSync(agentDir, { mode: 0o500 });
		try {
			// When creating context, then a real filesystem failure is reported.
			const outcome = initialize();
			expect(outcome.exitCode).toBe(1);
			expect(lines.join("\n")).toContain("EACCES");
			expect(readdirSync(agentDir)).toEqual([]);
		} finally {
			chmodSync(agentDir, 0o700);
		}
	});

	it.each(["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD", "Claude.md"])(
		"preserves the existing %s entry point without creating competing entry points",
		(name) => {
			// Given an existing user entry point with deliberate content.
			mkdirSync(agentDir);
			writeFileSync(join(agentDir, name), "# User-owned context\n");
			// When installing missing defaults.
			const outcome = initialize();
			// Then only the web companion is added.
			expect(outcome.exitCode).toBe(0);
			expect(readdirSync(agentDir).sort()).toEqual([name, "INTERNET.md"].sort());
			expect(readFileSync(join(agentDir, name), "utf8")).toBe("# User-owned context\n");
		},
	);

	it("preserves edits and creates no backups or duplicates on repeated setup", () => {
		// Given a completed setup that the user customized.
		initialize();
		writeFileSync(join(agentDir, "AGENTS.md"), "# Custom instructions\n");
		writeFileSync(join(agentDir, "INTERNET.md"), "# Custom network policy\n");
		// When setup runs again.
		const outcome = initialize();
		// Then user content is unchanged and the inventory is stable.
		expect(outcome.exitCode).toBe(0);
		expect(readdirSync(agentDir).sort()).toEqual(["AGENTS.md", "CLAUDE.md", "INTERNET.md"]);
		expect(readFileSync(join(agentDir, "AGENTS.md"), "utf8")).toBe("# Custom instructions\n");
		expect(readFileSync(join(agentDir, "INTERNET.md"), "utf8")).toBe("# Custom network policy\n");
	});

	it("reports missing bundled templates before creating any destination files", () => {
		// Given an incomplete package whose first template is still present.
		const brokenTemplates = join(root, "templates");
		mkdirSync(brokenTemplates);
		writeFileSync(join(brokenTemplates, "AGENTS.md"), "# Incomplete package\n");
		// When setup attempts to read the complete template set.
		const outcome = runInitCli(["init", "--global"], {
			agentDir,
			templatesDir: brokenTemplates,
			writeLine: (line) => lines.push(line),
		});
		// Then it fails without even creating the target directory.
		expect(outcome.exitCode).toBe(1);
		expect(readdirSync(root)).toEqual(["templates"]);
		expect(lines.join("\n")).toContain("ENOENT");
	});

	it("refuses an agent path that is a regular file", () => {
		// Given a non-directory destination.
		writeFileSync(agentDir, "existing file");
		// When setup is requested.
		const outcome = initialize();
		// Then that file is preserved and the failure is explicit.
		expect(outcome.exitCode).toBe(1);
		expect(readFileSync(agentDir, "utf8")).toBe("existing file");
	});

	it.skipIf(process.platform === "win32")("refuses a symlinked agent directory", () => {
		// Given an agent directory pointing elsewhere.
		const outside = join(root, "outside");
		mkdirSync(outside);
		symlinkSync(outside, agentDir, "dir");
		// When setup is requested.
		const outcome = initialize();
		// Then the destination is not followed or written.
		expect(outcome.exitCode).toBe(1);
		expect(readdirSync(outside)).toEqual([]);
	});

	it.skipIf(process.platform === "win32")("preserves dangling entry-point symlinks", () => {
		// Given a dangling symlink managed by the user's dotfiles setup.
		mkdirSync(agentDir);
		symlinkSync(join(root, "absent.md"), join(agentDir, "CLAUDE.md"));
		// When setup is requested.
		const outcome = initialize();
		// Then it does not shadow that symlink with a new AGENTS.md.
		expect(outcome.exitCode).toBe(0);
		expect(readdirSync(agentDir).sort()).toEqual(["CLAUDE.md", "INTERNET.md"]);
	});

	it.skipIf(process.platform === "win32")("creates owner-only files and directory on POSIX", () => {
		// Given an empty config, when setup runs.
		initialize();
		// Then initial context does not expose future personal edits to other users.
		expect(statSync(agentDir).mode & 0o777).toBe(0o700);
		for (const name of readdirSync(agentDir)) expect(statSync(join(agentDir, name)).mode & 0o777).toBe(0o600);
	});

	it("loads only the installed global AGENTS entry point through the real loader", () => {
		// Given an initialized config and a workspace with project-specific instructions.
		initialize();
		const workspace = join(root, "project");
		mkdirSync(workspace);
		writeFileSync(join(workspace, "AGENTS.md"), "# Project instructions\n");
		// When the real loader discovers context (without executing extensions).
		const files = loadProjectContextFiles({ cwd: workspace, agentDir });
		// Then INTERNET stays on-demand and CLAUDE does not duplicate the global instructions.
		expect(files.filter((file) => file.isGlobal).map((file) => file.path)).toEqual([join(agentDir, "AGENTS.md")]);
		expect(files.at(-1)?.path).toBe(join(workspace, "AGENTS.md"));
	});

	it("ships a portable template set with no machine-specific absolute paths", () => {
		// Given the actual package templates, when checking their distribution contract.
		const names = readdirSync(templatesDir).sort();
		// Then exactly the public set is present, small, and independent of a maintainer home.
		expect(names).toEqual(["AGENTS.md", "CLAUDE.md", "INTERNET.md"]);
		for (const name of names) {
			const text = readFileSync(join(templatesDir, name), "utf8");
			expect(text).not.toMatch(/\/(?:home|Users)\/[^/\s]+|[A-Z]:\\Users\\/);
			expect(text.length).toBeLessThan(6000);
		}
		expect(readFileSync(join(templatesDir, "CLAUDE.md"), "utf8")).toMatch(/^@AGENTS\.md$/m);
	});
});
