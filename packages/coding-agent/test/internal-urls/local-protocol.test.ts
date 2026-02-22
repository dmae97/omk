import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	InternalUrlRouter,
	LocalProtocolHandler,
	resolveLocalRoot,
	resolveLocalUrlToPath,
} from "../../src/internal-urls";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "local-protocol-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function createRouter(options: { artifactsDir?: string | null; sessionId?: string | null }): InternalUrlRouter {
	const router = new InternalUrlRouter();
	router.register(
		new LocalProtocolHandler({
			getArtifactsDir: () => options.artifactsDir ?? null,
			getSessionId: () => options.sessionId ?? null,
		}),
	);
	return router;
}

describe("LocalProtocolHandler", () => {
	it("lists files at local://", async () => {
		await withTempDir(async tempDir => {
			const artifactsDir = path.join(tempDir, "artifacts");
			await fs.mkdir(path.join(artifactsDir, "local"), { recursive: true });
			await Bun.write(path.join(artifactsDir, "local", "handoff.json"), '{"ok":true}');

			const router = createRouter({ artifactsDir, sessionId: "session-a" });
			const resource = await router.resolve("local://");

			expect(resource.contentType).toBe("text/markdown");
			expect(resource.content).toContain("handoff.json");
		});
	});

	it("reads a local file from session local root", async () => {
		await withTempDir(async tempDir => {
			const artifactsDir = path.join(tempDir, "artifacts");
			const localFile = path.join(artifactsDir, "local", "subtasks", "trace.txt");
			await fs.mkdir(path.dirname(localFile), { recursive: true });
			await Bun.write(localFile, "trace");

			const router = createRouter({ artifactsDir, sessionId: "session-b" });
			const resource = await router.resolve("local://subtasks/trace.txt");

			expect(resource.content).toBe("trace");
			expect(resource.contentType).toBe("text/plain");
		});
	});

	it("blocks path traversal attempts", async () => {
		await withTempDir(async tempDir => {
			const router = createRouter({ artifactsDir: path.join(tempDir, "artifacts"), sessionId: "session-c" });
			await expect(router.resolve("local://../secret.txt")).rejects.toThrow(
				"Path traversal (..) is not allowed in local:// URLs",
			);
			await expect(router.resolve("local://%2E%2E/secret.txt")).rejects.toThrow(
				"Path traversal (..) is not allowed in local:// URLs",
			);
		});
	});

	it("uses session id fallback root when artifacts dir is unavailable", async () => {
		const root = resolveLocalRoot({ getSessionId: () => "session-fallback", getArtifactsDir: () => null });
		expect(root).toContain(path.join("omp-local", "session-fallback"));
		expect(resolveLocalUrlToPath("local://memo.txt", { getSessionId: () => "session-fallback" })).toBe(
			path.join(root, "memo.txt"),
		);
	});

	it("blocks symlink escapes outside local root", async () => {
		if (process.platform === "win32") return;

		await withTempDir(async tempDir => {
			const artifactsDir = path.join(tempDir, "artifacts");
			const localRoot = path.join(artifactsDir, "local");
			const outsideDir = path.join(tempDir, "outside");
			await fs.mkdir(localRoot, { recursive: true });
			await fs.mkdir(outsideDir, { recursive: true });
			await Bun.write(path.join(outsideDir, "secret.txt"), "secret");
			await fs.symlink(outsideDir, path.join(localRoot, "linked"));

			const router = createRouter({ artifactsDir, sessionId: "session-d" });
			await expect(router.resolve("local://linked/secret.txt")).rejects.toThrow("local:// URL escapes local root");
		});
	});
});
