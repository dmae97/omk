/** Stable tool-name comparison shared by session activation and recovery. */
export function normalizeToolNames(toolNames: readonly string[]): string[] {
	return [...new Set(toolNames.map((name) => name.trim()).filter((name) => name !== ""))].sort((left, right) => {
		if (left < right) return -1;
		if (left > right) return 1;
		return 0;
	});
}

export function toolNameSetsEqual(left: readonly string[], right: readonly string[]): boolean {
	const normalizedLeft = normalizeToolNames(left);
	const normalizedRight = normalizeToolNames(right);
	return (
		normalizedLeft.length === normalizedRight.length &&
		normalizedLeft.every((name, index) => name === normalizedRight[index])
	);
}
