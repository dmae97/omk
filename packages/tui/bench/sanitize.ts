import { sanitizeText as nativeSanitizeText } from "@oh-my-pi/pi-natives";

function sanitizeBinaryOutput(str: string): string {
	let out: string[] | undefined;
	let last = 0;

	for (let i = 0; i < str.length; ) {
		const code = str.codePointAt(i)!;
		const width = code > 0xffff ? 2 : 1;
		const next = i + width;

		// Allow tab, newline, carriage return.
		const isAllowedControl = code === 0x09 || code === 0x0a || code === 0x0d;
		if (isAllowedControl) {
			i = next;
			continue;
		}

		// Filter out characters that crash `Bun.stringWidth()` or cause display issues:
		// - ASCII control chars (C0)
		// - DEL + C1 control block
		// - Lone surrogates
		const isControl = code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f);
		const isSurrogate = code >= 0xd800 && code <= 0xdfff;
		if (isControl || isSurrogate) {
			out ??= [];
			if (last !== i) out.push(str.slice(last, i));
			last = next;
		}

		i = next;
	}

	if (!out) return str;
	if (last < str.length) out.push(str.slice(last));
	return out.join("");
}
function jsSanitizeText(text: string): string {
	return sanitizeBinaryOutput(Bun.stripANSI(text)).replaceAll("\r", "");
}

const ITERATIONS = 2000;

const samples = {
	plain: "hello world this is a plain ASCII string with some words",
	ansi: "\x1b[31mred text\x1b[0m and \x1b[4munderlined content\x1b[24m with emoji 😅😅",
	links: "prefix \x1b]8;;https://example.com\x07link\x1b]8;;\x07 suffix",
	wide: "日本語のテキストとemoji 🚀✨ mixed with ascii",
	wrapped:
		"This is a long line that should wrap multiple times when rendered with ANSI \x1b[32mcolors\x1b[0m and tabs\tbetween words.",
};

const wrapWidth = 40;

function bench(name: string, fn: () => void): number {
	const start = Bun.nanoseconds();
	for (let i = 0; i < ITERATIONS; i++) {
		fn();
	}
	const elapsed = (Bun.nanoseconds() - start) / 1e6;
	const perOp = (elapsed / ITERATIONS).toFixed(6);
	console.log(`${name}: ${elapsed.toFixed(2)}ms total (${perOp}ms/op)`);
	return elapsed;
}

console.log(`Text layout benchmark (${ITERATIONS} iterations)\n`);

for (const [name, text] of Object.entries(samples)) {
   const jsResult = jsSanitizeText(text);
   const nativeResult = nativeSanitizeText(text);
   if (jsResult !== nativeResult) {
      console.log(`MISMATCH ${name}: js="${jsResult}" native="${nativeResult}"`);
   }

   bench(`jsSanitizeText/${name}`, () => {
      jsSanitizeText(text);
   });
   bench(`nativeSanitizeText/${name}`, () => {
      nativeSanitizeText(text);
   });
}


