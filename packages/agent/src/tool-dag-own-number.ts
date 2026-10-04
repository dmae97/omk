/** Resource dictionaries are data maps: Object.prototype is never a resource. */
export function ownResourceNumber(values: Readonly<Record<string, number>>, key: string): number | undefined {
	return Object.hasOwn(values, key) ? values[key] : undefined;
}
