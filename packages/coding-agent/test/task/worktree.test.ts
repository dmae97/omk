import { describe, expect, it, vi } from "bun:test";

const projfsOverlayStartMock = vi.fn();
const projfsOverlayStopMock = vi.fn();

vi.mock("@oh-my-pi/pi-natives", () => ({
	projfsOverlayStart: projfsOverlayStartMock,
	projfsOverlayStop: projfsOverlayStopMock,
}));

async function loadWorktreeHelpers() {
	const { getGitNoIndexNullPath, isProjfsUnavailableError } = await import("../../src/task/worktree");
	return { getGitNoIndexNullPath, isProjfsUnavailableError };
}

describe("worktree isolation helpers", () => {
	it("returns platform-specific null path for git --no-index diffs", async () => {
		const { getGitNoIndexNullPath } = await loadWorktreeHelpers();
		const expected = process.platform === "win32" ? "NUL" : "/dev/null";
		expect(getGitNoIndexNullPath()).toBe(expected);
	});

	it("detects ProjFS prerequisite errors by prefix", async () => {
		const { isProjfsUnavailableError } = await loadWorktreeHelpers();
		expect(isProjfsUnavailableError(new Error("PROJFS_UNAVAILABLE: missing feature"))).toBe(true);
		expect(isProjfsUnavailableError(new Error("fuse-overlay mount failed"))).toBe(false);
		expect(isProjfsUnavailableError("PROJFS_UNAVAILABLE: not-an-error-instance")).toBe(false);
	});
});
