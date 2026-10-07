import assert from "node:assert";
import { describe, it } from "node:test";
import { Markdown } from "../src/components/markdown.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

const DOCS = [
	"# Title\n\nPara one with **bold** and `code`.\n\n- a\n- b\n\n  continued item b\n\n- c\n\n1. one\n2. two\n\n10. ten\n",
	"Intro\n\n```ts\nconst a = 1;\n```\n\nAfter fence\n\n~~~\nraw ~~~ inside\n~~~\n\nend",
	"Setext heading\n===\n\nAnother\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\ntext after table",
	"> quote line\nlazy continuation\n\n> second quote\n> > nested\n\nplain\n\n    indented code\n    more\n\npara",
	"See [ref][r] and [other].\n\nMiddle paragraph.\n\n[r]: https://example.com\n[other]: https://example.org\n",
	"- item\n\n  ```py\n  print(1)\n  ```\n\n- next item\n  - nested\n    - deeper\n\nDone. <b>html</b>\n\n<div>\nblock\n</div>\n\n***\n\nlast",
	"Line one  \nhard break\n\n* star list\n+ plus list\n\n- [ ] task\n- [x] done\n\n```\nunclosed fence that never ends\nline",
];

function fresh(text: string, width: number): string[] {
	return new Markdown(text, 1, 0, defaultMarkdownTheme).render(width);
}

describe("Markdown streaming cache", () => {
	it("renders every streamed prefix exactly like a fresh render", () => {
		for (const doc of DOCS) {
			for (const step of [1, 3, 7]) {
				const md = new Markdown("", 1, 0, defaultMarkdownTheme);
				for (let n = 0; n <= doc.length; n += step) {
					const text = doc.slice(0, n);
					md.setText(text);
					assert.deepStrictEqual(md.render(60), fresh(text, 60), `step ${step}, prefix ${JSON.stringify(text)}`);
				}
			}
		}
	});

	it("handles width changes, edits that are not appends, and invalidate()", () => {
		const doc = DOCS[0] + DOCS[1];
		const md = new Markdown("", 1, 0, defaultMarkdownTheme);
		md.setText(doc);
		assert.deepStrictEqual(md.render(80), fresh(doc, 80));
		assert.deepStrictEqual(md.render(40), fresh(doc, 40));
		const edited = doc.replace("Para one", "Paragraph ONE");
		md.setText(edited);
		assert.deepStrictEqual(md.render(40), fresh(edited, 40));
		md.invalidate();
		assert.deepStrictEqual(md.render(40), fresh(edited, 40));
		const shorter = edited.slice(0, 30);
		md.setText(shorter);
		assert.deepStrictEqual(md.render(40), fresh(shorter, 40));
	});
});
