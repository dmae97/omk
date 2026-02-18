import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { InternalUrlRouter, MemoryProtocolHandler } from "../../src/internal-urls";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "memory-protocol-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function createRouter(memoryRoot: string): InternalUrlRouter {
	const router = new InternalUrlRouter();
	router.register(
		new MemoryProtocolHandler({
			getMemoryRoot: () => memoryRoot,
		}),
	);
	return router;
}

describe("MemoryProtocolHandler", () => {
	it("resolves memory://root to memory_summary.md", async () => {
		await withTempDir(async tempDir => {
			const memoryRoot = path.join(tempDir, "memory");
			await fs.mkdir(memoryRoot, { recursive: true });
			await Bun.write(path.join(memoryRoot, "memory_summary.md"), "summary");

			const router = createRouter(memoryRoot);
			const resource = await router.resolve("memory://root");

			expect(resource.content).toBe("summary");
			expect(resource.contentType).toBe("text/markdown");
		});
	});

	it("resolves memory://root/<path> within memory root", async () => {
		await withTempDir(async tempDir => {
			const memoryRoot = path.join(tempDir, "memory");
			const skillPath = path.join(memoryRoot, "skills", "demo", "SKILL.md");
			await fs.mkdir(path.dirname(skillPath), { recursive: true });
			await Bun.write(skillPath, "demo skill");

			const router = createRouter(memoryRoot);
			const resource = await router.resolve("memory://root/skills/demo/SKILL.md");

			expect(resource.content).toBe("demo skill");
			expect(resource.contentType).toBe("text/markdown");
		});
	});

	it("throws for unknown memory namespace", async () => {
		await withTempDir(async tempDir => {
			const memoryRoot = path.join(tempDir, "memory");
			await fs.mkdir(memoryRoot, { recursive: true });

			const router = createRouter(memoryRoot);
			await expect(router.resolve("memory://other/memory_summary.md")).rejects.toThrow(
				"Unknown memory namespace: other. Supported: root",
			);
		});
	});

	it("blocks path traversal attempts", async () => {
		await withTempDir(async tempDir => {
			const memoryRoot = path.join(tempDir, "memory");
			await fs.mkdir(memoryRoot, { recursive: true });

			const router = createRouter(memoryRoot);
			await expect(router.resolve("memory://root/../secret.md")).rejects.toThrow(
				"Path traversal (..) is not allowed in memory:// URLs",
			);
			await expect(router.resolve("memory://root/%2E%2E/secret.md")).rejects.toThrow(
				"Path traversal (..) is not allowed in memory:// URLs",
			);
		});
	});

	it("throws clear error for missing files", async () => {
		await withTempDir(async tempDir => {
			const memoryRoot = path.join(tempDir, "memory");
			await fs.mkdir(memoryRoot, { recursive: true });

			const router = createRouter(memoryRoot);
			await expect(router.resolve("memory://root/missing.md")).rejects.toThrow(
				"Memory file not found: memory://root/missing.md",
			);
		});
	});

	it("blocks symlink escapes outside memory root", async () => {
		if (process.platform === "win32") return;

		await withTempDir(async tempDir => {
			const memoryRoot = path.join(tempDir, "memory");
			const outsideDir = path.join(tempDir, "outside");
			await fs.mkdir(memoryRoot, { recursive: true });
			await fs.mkdir(outsideDir, { recursive: true });
			await Bun.write(path.join(outsideDir, "secret.md"), "secret");
			await fs.symlink(outsideDir, path.join(memoryRoot, "linked"));

			const router = createRouter(memoryRoot);
			await expect(router.resolve("memory://root/linked/secret.md")).rejects.toThrow(
				"memory:// URL escapes memory root",
			);
		});
	});
});
