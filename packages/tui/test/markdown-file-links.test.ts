import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Markdown } from "../src/components/markdown.ts";
import { resetCapabilitiesCache, setCapabilities } from "../src/terminal-image.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

const target = "file://wsl.localhost/Ubuntu-24.04/projects/app/docs/mobile-after.png";
const theme = {
	...defaultMarkdownTheme,
	resolveLink: (href: string) => (href === "docs/mobile-after.png" ? target : href),
	resolveFileLink: (text: string) => (text === "docs/mobile-after.png" ? target : undefined),
};

afterEach(() => resetCapabilitiesCache());

test("markdown links resolve local destinations before emitting OSC8", () => {
	// Given a host-specific destination resolver.
	setCapabilities({ images: null, trueColor: true, hyperlinks: true });
	// When rendering a labeled artifact link.
	const output = new Markdown("[모바일 수정 화면](docs/mobile-after.png)", 0, 0, theme).render(100).join("\n");
	// Then the label carries the resolved URL.
	assert.ok(output.includes(`\x1b]8;;${target}\x1b\\`));
	assert.ok(output.includes("모바일 수정 화면"));
});

test("markdown image references and existing inline-code paths are clickable", () => {
	setCapabilities({ images: null, trueColor: true, hyperlinks: true });
	const output = new Markdown("![수정 후](docs/mobile-after.png)\n\n`docs/mobile-after.png`", 0, 0, theme)
		.render(100)
		.join("\n");
	assert.equal(output.split(`\x1b]8;;${target}\x1b\\`).length - 1, 2);
});

test("formatted paths and image labels inside links do not emit nested OSC8 sequences", () => {
	setCapabilities({ images: null, trueColor: true, hyperlinks: true });
	for (const label of ["`docs/mobile-after.png`", "![preview](docs/mobile-after.png)"]) {
		const output = new Markdown(`[${label}](docs/mobile-after.png)`, 0, 0, theme).render(120).join("\n");
		assert.equal(output.split(`\x1b]8;;${target}\x1b\\`).length - 1, 1);
	}
});

test("plain fallback shows the resolved file URL when OSC8 is unavailable", () => {
	setCapabilities({ images: null, trueColor: true, hyperlinks: false });
	const output = new Markdown("[검토 보고서](docs/mobile-after.png)", 0, 0, theme).render(200).join("\n");
	assert.ok(output.includes(target));
	assert.ok(!output.includes("\x1b]8;;"));
});

test("ordinary code stays code and remote URLs remain unchanged", () => {
	setCapabilities({ images: null, trueColor: true, hyperlinks: true });
	const output = new Markdown("`a / b` [website](https://example.com/a?q=1)", 0, 0, theme).render(120).join("\n");
	assert.ok(output.includes("a / b"));
	assert.ok(output.includes("\x1b]8;;https://example.com/a?q=1\x1b\\"));
	assert.ok(!output.includes(target));
});
