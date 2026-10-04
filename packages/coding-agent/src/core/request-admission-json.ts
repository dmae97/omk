/** Limits are consumed BEFORE building strings. This is a local projection, not a provider serializer. */
export interface AdmissionJsonBudget {
	remaining: number;
	nodes: number;
}
export function representationLimit(): never {
	throw new RangeError("admission.representation_limit");
}
function charge(budget: AdmissionJsonBudget, length: number): void {
	if (!Number.isSafeInteger(length) || length < 0 || length > budget.remaining) representationLimit();
	budget.remaining -= length;
}
function quoted(text: string, budget: AdmissionJsonBudget): string {
	if (text.length > budget.remaining) representationLimit();
	let length = 2;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13)
			length += 2;
		else if (code < 32) length += 6;
		else if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				length += 2;
				i++;
			} else length += 6;
		} else if (code >= 0xdc00 && code <= 0xdfff) length += 6;
		else length++;
		if (length > budget.remaining) representationLimit();
	}
	charge(budget, length);
	return JSON.stringify(text);
}
export function boundedAdmissionJson(value: unknown, budget: AdmissionJsonBudget): string {
	const ancestors = new WeakSet<object>();
	function visit(current: unknown, depth: number): string {
		if (depth > 64 || ++budget.nodes > 100000) representationLimit();
		if (current === null) {
			charge(budget, 4);
			return "null";
		}
		if (typeof current === "string") return quoted(current, budget);
		if (typeof current === "boolean") {
			const text = String(current);
			charge(budget, text.length);
			return text;
		}
		if (typeof current === "number" && Number.isFinite(current)) {
			const text = JSON.stringify(current);
			charge(budget, text.length);
			return text;
		}
		if (typeof current !== "object" || current === null) throw new TypeError("admission.invalid_json");
		if (ancestors.has(current)) throw new TypeError("admission.cyclic_json");
		const prototype = Object.getPrototypeOf(current);
		if (Array.isArray(current) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null)
			throw new TypeError("admission.invalid_json_prototype");
		const customJson = Object.getOwnPropertyDescriptor(current, "toJSON");
		if (customJson && (!("value" in customJson) || typeof customJson.value === "function"))
			throw new TypeError("admission.custom_json");
		ancestors.add(current);
		try {
			charge(budget, 2);
			const parts: string[] = [];
			if (Array.isArray(current)) {
				if (current.length > budget.remaining + 1 || current.length > 100000) representationLimit();
				for (let index = 0; index < current.length; index++) {
					if (index > 0) charge(budget, 1);
					const desc = Object.getOwnPropertyDescriptor(current, String(index));
					if (desc && !("value" in desc)) throw new TypeError("admission.json_accessor");
					parts.push(visit(desc?.value === undefined ? null : desc.value, depth + 1));
				}
				return `[${parts.join(",")}]`;
			}
			// JSON ignores symbols and non-enumerable metadata (including TypeBox markers).
			for (const key of Object.keys(current)) {
				const desc = Object.getOwnPropertyDescriptor(current, key);
				if (!desc || !("value" in desc)) throw new TypeError("admission.json_accessor");
				if (desc.value === undefined) continue;
				if (parts.length > 0) charge(budget, 1);
				const name = quoted(key, budget);
				charge(budget, 1);
				parts.push(`${name}:${visit(desc.value, depth + 1)}`);
			}
			return `{${parts.join(",")}}`;
		} finally {
			ancestors.delete(current);
		}
	}
	return visit(value, 0);
}
