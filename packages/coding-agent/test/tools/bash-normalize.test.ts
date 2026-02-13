import { describe, expect, it } from "bun:test";
import { applyHeadTail, normalizeBashCommand } from "../../src/tools/bash-normalize";

describe("normalizeBashCommand", () => {
	describe("head/tail extraction", () => {
		it("extracts | head -n N", () => {
			const result = normalizeBashCommand("ls -la | head -n 50");
			expect(result.command).toBe("ls -la");
			expect(result.headLines).toBe(50);
			expect(result.tailLines).toBeUndefined();
		});

		it("extracts | head -N (short form)", () => {
			const result = normalizeBashCommand("cat file.txt | head -20");
			expect(result.command).toBe("cat file.txt");
			expect(result.headLines).toBe(20);
		});

		it("extracts | tail -n N", () => {
			const result = normalizeBashCommand("dmesg | tail -n 100");
			expect(result.command).toBe("dmesg");
			expect(result.tailLines).toBe(100);
			expect(result.headLines).toBeUndefined();
		});

		it("extracts | tail -N (short form)", () => {
			const result = normalizeBashCommand("journalctl | tail -50");
			expect(result.command).toBe("journalctl");
			expect(result.tailLines).toBe(50);
		});

		it("handles multiple spaces around pipe", () => {
			const result = normalizeBashCommand("git log   |   head -n 10");
			expect(result.command).toBe("git log");
			expect(result.headLines).toBe(10);
		});

		it("does not extract head/tail in middle of pipeline", () => {
			const result = normalizeBashCommand("cat file | head -n 10 | grep foo");
			expect(result.command).toBe("cat file | head -n 10 | grep foo");
			expect(result.headLines).toBeUndefined();
			expect(result.tailLines).toBeUndefined();
		});

		it("does not extract head without line count", () => {
			const result = normalizeBashCommand("cat file | head");
			expect(result.command).toBe("cat file | head");
			expect(result.headLines).toBeUndefined();
		});

		it("does not extract head with other flags", () => {
			const result = normalizeBashCommand("cat file | head -c 100");
			expect(result.command).toBe("cat file | head -c 100");
			expect(result.headLines).toBeUndefined();
		});
	});

	describe("no patterns", () => {
		it("preserves command unchanged", () => {
			const result = normalizeBashCommand("git status");
			expect(result.command).toBe("git status");
			expect(result.headLines).toBeUndefined();
			expect(result.tailLines).toBeUndefined();
		});

		it("preserves internal spacing and tabs", () => {
			const result = normalizeBashCommand("echo 'a    b\t\tc'");
			expect(result.command).toBe("echo 'a    b\t\tc'");
		});

		it("preserves heredoc indentation", () => {
			const command = "python3 - <<'PY'\nfor i in [1]:\n    if True:\n        x = 1\nPY";
			const result = normalizeBashCommand(command);
			expect(result.command).toBe(command);
		});
	});
});

describe("applyHeadTail", () => {
	const sampleText = "line1\nline2\nline3\nline4\nline5";

	it("returns original when no limits", () => {
		const result = applyHeadTail(sampleText);
		expect(result.text).toBe(sampleText);
		expect(result.applied).toBe(false);
	});

	it("applies head limit", () => {
		const result = applyHeadTail(sampleText, 2);
		expect(result.text).toBe("line1\nline2");
		expect(result.applied).toBe(true);
		expect(result.headApplied).toBe(2);
	});

	it("applies tail limit", () => {
		const result = applyHeadTail(sampleText, undefined, 2);
		expect(result.text).toBe("line4\nline5");
		expect(result.applied).toBe(true);
		expect(result.tailApplied).toBe(2);
	});

	it("applies head then tail", () => {
		const result = applyHeadTail(sampleText, 4, 2);
		// head=4 gives: line1\nline2\nline3\nline4
		// tail=2 of that gives: line3\nline4
		expect(result.text).toBe("line3\nline4");
		expect(result.applied).toBe(true);
		expect(result.headApplied).toBe(4);
		expect(result.tailApplied).toBe(2);
	});

	it("does not apply if text is shorter than limit", () => {
		const result = applyHeadTail(sampleText, 10);
		expect(result.text).toBe(sampleText);
		expect(result.applied).toBe(false);
	});

	it("handles empty text", () => {
		const result = applyHeadTail("", 5);
		expect(result.text).toBe("");
		expect(result.applied).toBe(false);
	});

	it("handles single line", () => {
		const result = applyHeadTail("single", 1);
		expect(result.text).toBe("single");
		expect(result.applied).toBe(false);
	});
});
