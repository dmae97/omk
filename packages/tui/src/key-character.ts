/** Legacy control characters, including the US-layout '-'/'_' physical-key alias. */
export function rawCtrlChar(key: string): string | null {
	const char = key.toLowerCase();
	const code = char.charCodeAt(0);
	if ((code >= 97 && code <= 122) || char === "[" || char === "\\" || char === "]" || char === "_")
		return String.fromCharCode(code & 0x1f);
	if (char === "-") return String.fromCharCode(31);
	return null;
}
