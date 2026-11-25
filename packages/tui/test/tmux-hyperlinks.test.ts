import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { probeTmuxHyperlinks } from "../src/tmux-hyperlinks.ts";

describe("probeTmuxHyperlinks", () => {
	it("returns true when attached client_termfeatures advertises hyperlinks", () => {
		assert.equal(
			probeTmuxHyperlinks(() => "bpaste,clipboard,hyperlinks,title\n"),
			true,
		);
	});

	it("returns false when attached client_termfeatures lacks hyperlinks", () => {
		assert.equal(
			probeTmuxHyperlinks(() => "bpaste,clipboard,title\n"),
			false,
		);
	});

	it("falls back to server terminal-features when no client is attached yet", () => {
		const calls: (readonly string[])[] = [];
		const ok = probeTmuxHyperlinks((args) => {
			calls.push(args);
			if (args[0] === "display-message") return "\n";
			return "xterm*:clipboard:title\nxterm*:hyperlinks\n";
		});
		assert.equal(ok, true);
		assert.equal(calls.length, 2);
	});

	it("returns false when detached and server terminal-features also lacks hyperlinks", () => {
		const ok = probeTmuxHyperlinks((args) => {
			if (args[0] === "display-message") return "";
			return "xterm*:clipboard:title\n";
		});
		assert.equal(ok, false);
	});
});
