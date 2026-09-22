/** Recursively key-sorted JSON, preserving the existing journal serialization contract. */
export function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		const object = value as Record<string, unknown>;
		const parts: string[] = [];
		for (const key of Object.keys(object).sort()) {
			const child = object[key];
			if (child === undefined) continue;
			parts.push(`${JSON.stringify(key)}:${canonicalJson(child)}`);
		}
		return `{${parts.join(",")}}`;
	}
	return JSON.stringify(value);
}
