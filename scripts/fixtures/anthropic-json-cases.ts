// Inputs only: expected values always come from the existing Node implementation.
export const jsonInputs = [
	"", "   ", "{}", "[]", "null", "nu", "true", "tr", "false", "fa", "0", "-", "-12.5", "12e", "12E+", "1e3",
	"\uFEFFnu", "\u00A0nu", "\uFEFFtrue", "\u0085nu",
	"NaN", "Inf", "-Inf", '{"a":1,"broken":nope}', '{"a":1,}', '[1,2,]', '{"a" 1}', '{"a":1}trailing',
	String.raw`{"text":"\"\\\/\b\f\n\r\t\u00e9"}`,
	String.raw`{"path":"A\H","text":"bad\q"}`,
	'{"text":"col1\tcol2\u0000end"}', String.raw`{"text":"\uZZZZ"}`, '"tail\\',
	'{"__proto__":{"polluted":true},"constructor":"literal"}',
	...Array.from({ length: 32 }, (_, code) => `{"control":"a${String.fromCharCode(code)}b"}`),
];
const documents = [
	'{"path":"한글/🌍.txt","count":-12.5e2,"enabled":true,"nothing":null,"items":[1,{"a":"line\\nnext"}]}',
	String.raw`{"path":"A\H","unicode":"\u00e9","escape":"quote\" slash\\"}`,
	'{"ok":1,"bad":bogus}', '[1,true,null,{"nested":["x","y"]}]',
	'{"__proto__":{"polluted":true},"constructor":"literal"}',
];
for (const document of documents) {
	const chars = Array.from(document);
	for (let length = 1; length <= chars.length; length++) jsonInputs.push(chars.slice(0, length).join(""));
}

export interface JsonStreamCase {
	id: string;
	parts: string[];
	finish?: "eof" | "cancel" | "error";
	initial?: Record<string, unknown>;
	rawSse?: string;
}
export const jsonStreamCases: JsonStreamCase[] = [
	{ id: "repair-tool", parts: ['{"path":"A\\H",', '"text":"col1\tcol2"}'] },
	{ id: "incomplete-string", parts: ['{"path":"한', '글/🌍'] },
	{ id: "incomplete-nested", parts: ['{"ok":1,"items":[', '{"x":"y', 'z"},2,'] },
	{ id: "incomplete-unicode", parts: [String.raw`{"text":"ok\u12`] },
	{ id: "invalid-member", parts: ['{"ok":1,"bad":', 'nope'] },
	{ id: "trailing-garbage", parts: ['{"ok":1}', 'broken'] },
	{ id: "empty-tool", parts: [], initial: { seed: "initial" } },
	{ id: "partial-null", parts: ['nu'] }, { id: "null", parts: ['null'] },
	{ id: "partial-bool", parts: ['tr'] }, { id: "partial-number", parts: ['12e'] },
	{ id: "eof-tool", parts: ['{"path":"part'], finish: "eof" },
	{ id: "cancel-tool", parts: ['{"path":"part'], finish: "cancel" },
	{ id: "error-tool", parts: ['{"path":"part'], finish: "error" },
	{ id: "prototype-key", parts: ['{"__proto__":{"polluted":true},', '"safe":1'] },
	{ id: "raw-sse-repair", parts: [], rawSse: String.raw`{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"A\H\"}"}}` },
	{ id: "raw-sse-invalid", parts: [], rawSse: "{" },
];
