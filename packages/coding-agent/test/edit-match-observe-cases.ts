/** Shared fixture cases for edit-match-observe tests (golden captured from main 9e03b40b77). */
export interface EditCase {
	name: string;
	file: string;
	edits: { oldText: string; newText: string }[];
}

export const EDIT_CASES: EditCase[] = [
	{ name: "exact", file: "alpha\nbeta\ngamma\n", edits: [{ oldText: "beta", newText: "BETA" }] },
	{ name: "fuzzy-trailing-ws", file: "alpha  \nbeta\n", edits: [{ oldText: "alpha\nbeta", newText: "A\nB" }] },
	{ name: "fuzzy-smart-quote", file: "say \u201chi\u201d\n", edits: [{ oldText: 'say "hi"', newText: "say bye" }] },
	{ name: "crlf-bom", file: "\uFEFFone\r\ntwo\r\n", edits: [{ oldText: "two", newText: "TWO" }] },
	{
		name: "multi",
		file: "a1\nb2\nc3\n",
		edits: [
			{ oldText: "a1", newText: "A1" },
			{ oldText: "c3  ", newText: "C3" },
		],
	},
	{ name: "not-found", file: "alpha\nbeta\n", edits: [{ oldText: "zeta", newText: "x" }] },
	{ name: "indent-only", file: "def f():\n    return 1\n", edits: [{ oldText: "def f():\nreturn 1", newText: "x" }] },
	{ name: "duplicate", file: "x\nx\nx\n", edits: [{ oldText: "x", newText: "y" }] },
	{
		name: "overlap",
		file: "abcdef\n",
		edits: [
			{ oldText: "abcd", newText: "1" },
			{ oldText: "cdef", newText: "2" },
		],
	},
	{ name: "no-op", file: "same\n", edits: [{ oldText: "same", newText: "same" }] },
];
