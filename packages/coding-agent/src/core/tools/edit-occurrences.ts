/**
 * Count every start position of `needle` in `haystack`, including starts that overlap an
 * earlier match. `split()` skips overlapping starts, so it counted "aaa" once in "aaaa"
 * although the spans at 0 and 1 both match, and the edit tool replaced the first silently.
 */
export function countOverlappingOccurrences(haystack: string, needle: string): number {
	// An empty needle (whitespace-only oldText after normalization) matches at every index and
	// would never advance the loop; keep the count split() has always returned for it.
	if (needle.length === 0) return haystack.split(needle).length - 1;
	let count = 0;
	for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) count++;
	return count;
}
