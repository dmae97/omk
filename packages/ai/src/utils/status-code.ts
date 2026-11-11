/**
 * Status-code-context match: a bare `500` inside a message body ("saved 500
 * records") is not a status code, so numeric matches require an adjacent
 * transport word — either a code-context word before the digits ("HTTP 429",
 * "error 503", "status 401") or a status-context word after them ("503
 * Upstream request failed", "429 Too Many Requests", "500 Internal Server
 * Error"). Structured `status`/`errorCode` fields on the caller's side still
 * outrank this text heuristic entirely.
 */
export function hasStatusCodeLike(text: string, codes: readonly number[]): boolean {
	const left = /(?:https?|status(?:\s*code)?|error(?:\s*code)?|code)\s*:?\s*(\d{3})\b/gi;
	const right =
		/\b(\d{3})\s+(?:too many|upstream|bad gateway|service unavailable|internal server|gateway|error|status|request failed|timed? ?out|unauthori[sz]ed|forbidden|web server|connection timed out|origin (?:is )?unreachable|a timeout occurred|ssl handshake|invalid ssl certificate|railgun)/gi;
	for (const re of [left, right]) {
		re.lastIndex = 0;
		for (;;) {
			const match = re.exec(text);
			if (match === null) break;
			if (codes.includes(Number.parseInt(match[1], 10))) return true;
		}
	}
	return false;
}
