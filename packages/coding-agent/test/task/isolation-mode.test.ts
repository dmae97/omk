import { afterEach, describe, expect, it, vi } from "bun:test";

const projfsOverlayProbeMock = vi.fn();
const ensureProjfsOverlayMock = vi.fn();
const cleanupProjfsOverlayMock = vi.fn();
const isProjfsUnavailableErrorMock = vi.fn(
	(err: unknown) => err instanceof Error && err.message.includes("PROJFS_UNAVAILABLE:"),
);

vi.mock("@oh-my-pi/pi-natives", () => ({
	projfsOverlayProbe: projfsOverlayProbeMock,
}));

vi.mock("../../src/task/worktree", () => ({
	ensureProjfsOverlay: ensureProjfsOverlayMock,
	cleanupProjfsOverlay: cleanupProjfsOverlayMock,
	isProjfsUnavailableError: isProjfsUnavailableErrorMock,
	getGitNoIndexNullPath: () => (process.platform === "win32" ? "NUL" : "/dev/null"),
}));

async function loadIsolatedBackend() {
	const { resolveIsolationBackendForTaskExecution } = await import("../../src/task/isolation-backend");
	return {
		resolveIsolationBackendForTaskExecution,
		projfsOverlayProbeMock,
		ensureProjfsOverlayMock,
		cleanupProjfsOverlayMock,
		isProjfsUnavailableErrorMock,
	};
}

describe("resolveIsolationBackendForTaskExecution", () => {
	afterEach(() => {
		vi.clearAllMocks();
		isProjfsUnavailableErrorMock.mockImplementation(
			(err: unknown) => err instanceof Error && err.message.includes("PROJFS_UNAVAILABLE:"),
		);
	});

	it("falls back to worktree when fuse-overlay is requested on Windows", async () => {
		const backend = await loadIsolatedBackend();

		const resolved = await backend.resolveIsolationBackendForTaskExecution("fuse-overlay", true, "C:/repo", "win32");

		expect(resolved.effectiveIsolationMode).toBe("worktree");
		expect(resolved.warning).toContain("fuse-projfs");
		expect(backend.projfsOverlayProbeMock).not.toHaveBeenCalled();
	});

	it("falls back to worktree when fuse-projfs is requested on non-Windows", async () => {
		const backend = await loadIsolatedBackend();

		const resolved = await backend.resolveIsolationBackendForTaskExecution("fuse-projfs", true, "/repo", "linux");

		expect(resolved.effectiveIsolationMode).toBe("worktree");
		expect(resolved.warning).toContain("only available on Windows");
		expect(backend.projfsOverlayProbeMock).not.toHaveBeenCalled();
	});

	it("falls back to worktree when ProjFS probe is unavailable on Windows", async () => {
		const backend = await loadIsolatedBackend();
		backend.projfsOverlayProbeMock.mockReturnValue({
			available: false,
			reason: "Client-ProjFS optional feature disabled",
		});

		const resolved = await backend.resolveIsolationBackendForTaskExecution("fuse-projfs", true, "C:/repo", "win32");

		expect(resolved.effectiveIsolationMode).toBe("worktree");
		expect(resolved.warning).toContain("Falling back to worktree isolation");
		expect(backend.ensureProjfsOverlayMock).not.toHaveBeenCalled();
	});

	it("falls back to worktree when ProjFS preflight returns prerequisite error", async () => {
		const backend = await loadIsolatedBackend();
		backend.projfsOverlayProbeMock.mockReturnValue({ available: true });
		backend.ensureProjfsOverlayMock.mockRejectedValue(
			new Error("PROJFS_UNAVAILABLE: filesystem does not support ProjFS"),
		);
		backend.isProjfsUnavailableErrorMock.mockReturnValue(true);

		const resolved = await backend.resolveIsolationBackendForTaskExecution("fuse-projfs", true, "C:/repo", "win32");

		expect(resolved.effectiveIsolationMode).toBe("worktree");
		expect(resolved.warning).toContain("filesystem does not support ProjFS");
		expect(backend.cleanupProjfsOverlayMock).not.toHaveBeenCalled();
	});

	it("keeps fuse-projfs backend when ProjFS preflight succeeds", async () => {
		const backend = await loadIsolatedBackend();
		backend.projfsOverlayProbeMock.mockReturnValue({ available: true });
		backend.ensureProjfsOverlayMock.mockResolvedValue("C:/repo/.tmp/merged");
		backend.isProjfsUnavailableErrorMock.mockReturnValue(false);

		const resolved = await backend.resolveIsolationBackendForTaskExecution("fuse-projfs", true, "C:/repo", "win32");

		expect(resolved.effectiveIsolationMode).toBe("fuse-projfs");
		expect(resolved.warning).toBe("");
		expect(backend.cleanupProjfsOverlayMock).toHaveBeenCalledWith("C:/repo/.tmp/merged");
	});

	it("throws when ProjFS preflight fails for non-prerequisite reasons", async () => {
		const backend = await loadIsolatedBackend();
		backend.projfsOverlayProbeMock.mockReturnValue({ available: true });
		backend.ensureProjfsOverlayMock.mockRejectedValue(new Error("unexpected mount failure"));
		backend.isProjfsUnavailableErrorMock.mockReturnValue(false);

		await expect(
			backend.resolveIsolationBackendForTaskExecution("fuse-projfs", true, "C:/repo", "win32"),
		).rejects.toThrow("ProjFS isolation initialization failed. unexpected mount failure");
	});
});
