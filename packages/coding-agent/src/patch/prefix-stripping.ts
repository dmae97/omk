/**
 * Pattern matching hashline display format prefixes:
 * `LINE#ID:CONTENT`, `#ID:CONTENT`, and `+ID:CONTENT`.
 * A plus-prefixed form appears in diff-like output and should be treated
 * as hashline metadata too.
 */
const HASHLINE_PREFIX_RE = /^\s*(?:>>>|>>)?\s*(?:\+?\s*(?:\d+\s*#\s*|#\s*)|\+)\s*[ZPMQVRWSNKTXJBYH]{2}:/;
const HASHLINE_PREFIX_PLUS_RE = /^\s*(?:>>>|>>)?\s*\+\s*(?:\d+\s*#\s*|#\s*)?[ZPMQVRWSNKTXJBYH]{2}:/;

/**
 * Pattern matching a unified-diff added-line `+` prefix (but not `++`).
 * Does NOT match `-` to avoid corrupting Markdown list items.
 */
const DIFF_PLUS_RE = /^[+](?![+])/;

/**
 * Strip hashline display prefixes and diff `+` markers from replacement lines.
 *
 * Models frequently copy the `LINE#ID:` prefix from read output into their
 * replacement content, or include unified-diff `+` prefixes. Both corrupt the
 * output file. This strips them heuristically before application.
 */
export function stripNewLinePrefixes(lines: string[]): string[] {
	let hashPrefixCount = 0;
	let diffPlusHashPrefixCount = 0;
	let diffPlusCount = 0;
	let nonEmpty = 0;
	for (const line of lines) {
		if (line.length === 0) continue;
		nonEmpty++;
		if (HASHLINE_PREFIX_RE.test(line)) hashPrefixCount++;
		if (HASHLINE_PREFIX_PLUS_RE.test(line)) diffPlusHashPrefixCount++;
		if (DIFF_PLUS_RE.test(line)) diffPlusCount++;
	}
	if (nonEmpty === 0) return lines;

	const stripHash = hashPrefixCount > 0 && hashPrefixCount === nonEmpty;
	const stripPlus =
		!stripHash && diffPlusHashPrefixCount === 0 && diffPlusCount > 0 && diffPlusCount >= nonEmpty * 0.5;
	if (!stripHash && !stripPlus && diffPlusHashPrefixCount === 0) return lines;

	return lines.map(line => {
		if (stripHash) return line.replace(HASHLINE_PREFIX_RE, "");
		if (stripPlus) return line.replace(DIFF_PLUS_RE, "");
		if (diffPlusHashPrefixCount > 0 && HASHLINE_PREFIX_PLUS_RE.test(line)) {
			return line.replace(HASHLINE_PREFIX_RE, "");
		}
		return line;
	});
}

/**
 * Strip hashline display prefixes only (no diff markers).
 *
 * Unlike {@link stripNewLinePrefixes} which also handles `+` diff markers,
 * this only strips `LINE#ID:` / `#ID:` prefixes.
 *
 * Returns the original array reference when no stripping is needed.
 */
export function stripHashlinePrefixes(lines: string[]): string[] {
	let hashPrefixCount = 0;
	let nonEmpty = 0;
	for (const line of lines) {
		if (line.length === 0) continue;
		nonEmpty++;
		if (HASHLINE_PREFIX_RE.test(line)) hashPrefixCount++;
	}
	if (nonEmpty === 0 || hashPrefixCount !== nonEmpty) return lines;
	return lines.map(line => line.replace(HASHLINE_PREFIX_RE, ""));
}
