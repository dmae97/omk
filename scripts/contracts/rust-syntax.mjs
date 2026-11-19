// Deliberately bounded Rust syntax reader, not a general Rust compiler.
// Unsupported syntax must stop generation instead of guessing a wire shape.
export function tokens(source) {
	const result = [];
	let i = 0;
	while (i < source.length) {
		if (/\s/.test(source[i])) {
			i++;
			continue;
		}
		if (source.startsWith("//", i)) {
			i = source.indexOf("\n", i);
			if (i < 0) break;
			continue;
		}
		if (source.startsWith("/*", i)) {
			let depth = 1;
			i += 2;
			while (depth && i < source.length) {
				if (source.startsWith("/*", i)) {
					depth++;
					i += 2;
				} else if (source.startsWith("*/", i)) {
					depth--;
					i += 2;
				} else i++;
			}
			if (depth) throw Error("unterminated Rust comment");
			continue;
		}
		const rest = source.slice(i);
		const raw = rest.match(/^r(#+)?"/);
		if (raw) {
			const end = '"' + (raw[1] ?? "");
			const stop = source.indexOf(end, i + raw[0].length);
			if (stop < 0) throw Error("unterminated Rust raw string");
			result.push(source.slice(i, stop + end.length));
			i = stop + end.length;
			continue;
		}
		const match = rest.match(
			/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])'|'?[A-Za-z_][A-Za-z_0-9]*|[0-9][0-9_]*(?:\.[0-9_]+)?|::|=>|->|&&|\|\||[^\s])/s,
		);
		if (!match) throw Error("unsupported Rust token");
		result.push(match[0]);
		i += match[0].length;
	}
	return result;
}
export function split(items, separator = ",") {
	const parts = [];
	let start = 0;
	const stack = [];
	for (let i = 0; i < items.length; i++) {
		if (["(", "[", "{", "<"].includes(items[i])) stack.push(items[i]);
		else if ([")", "]", "}", ">"].includes(items[i])) stack.pop();
		if (items[i] === separator && !stack.length) {
			if (i > start) parts.push(items.slice(start, i));
			start = i + 1;
		}
	}
	if (start < items.length) parts.push(items.slice(start));
	return parts;
}
export class Cursor {
	constructor(items) {
		this.items = items;
		this.i = 0;
	}
	peek() {
		return this.items[this.i];
	}
	take(expected) {
		const value = this.items[this.i++];
		if (expected !== undefined && value !== expected)
			throw Error(`unsupported Rust syntax: expected ${expected}, got ${value}`);
		return value;
	}
	group(open = this.peek()) {
		const closing = { "(": ")", "[": "]", "{": "}", "<": ">" }[open];
		if (!closing) throw Error("unsupported Rust group");
		this.take(open);
		const start = this.i;
		let depth = 1;
		while (this.i < this.items.length) {
			const next = this.take();
			if (next === open) depth++;
			if (next === closing && !--depth) return this.items.slice(start, this.i - 1);
		}
		throw Error("unterminated Rust group");
	}
	until(end) {
		const start = this.i;
		while (this.peek() !== end && this.peek() !== undefined) this.i++;
		if (this.peek() !== end) throw Error("missing Rust delimiter");
		return this.items.slice(start, this.i);
	}
}
export const literal = (value) => {
	try {
		return JSON.parse(value);
	} catch {
		throw Error("unsupported Rust string literal");
	}
};
export function attributes(cursor) {
	const result = { serde: {}, derive: [], path: null };
	while (cursor.peek() === "#") {
		cursor.take();
		if (cursor.peek() === "!") cursor.take();
		const item = cursor.group("[");
		const name = item[0];
		if (name === "serde") {
			for (const property of split(item.slice(2, -1))) {
				const key = property[0];
				if (
					![
						"tag",
						"content",
						"rename",
						"rename_all",
						"rename_all_fields",
						"untagged",
						"transparent",
						"default",
						"flatten",
						"skip_serializing_if",
						"deserialize_with",
						"try_from",
						"into",
					].includes(key)
				)
					throw Error(`unsupported serde attribute: ${key}`);
				if (Object.hasOwn(result.serde, key)) throw Error(`duplicate serde attribute: ${key}`);
				result.serde[key] = property.length === 1 ? true : literal(property[2]);
			}
		} else if (name === "cfg") throw Error("unsupported conditional Rust wire source");
		else if (name === "derive") result.derive = item.slice(2, -1).filter((x) => x !== ",");
		else if (name === "path") result.path = literal(item[2]);
		else if (!["forbid", "allow", "default"].includes(name)) throw Error(`unsupported Rust attribute: ${name}`);
	}
	return result;
}
export function typeExpression(items) {
	const c = new Cursor(items);
	if (c.peek() === "(") {
		const tuple = split(c.group("(")).map(typeExpression);
		if (c.peek() !== undefined) throw Error("unsupported tuple type");
		return { tuple };
	}
	const path = [c.take()];
	while (c.peek() === "::") {
		c.take();
		path.push(c.take());
	}
	const args = c.peek() === "<" ? split(c.group("<")).map(typeExpression) : [];
	if (c.peek() !== undefined) throw Error(`unsupported Rust type: ${items.join(" ")}`);
	return { path, args };
}
export function fields(items, named) {
	return split(items).map((part, index) => {
		const c = new Cursor(part);
		const attrs = attributes(c);
		if (c.peek() === "pub") {
			c.take();
			if (c.peek() === "(") c.group();
		}
		const name = named ? c.take() : String(index);
		if (named) c.take(":");
		const type = typeExpression(c.items.slice(c.i));
		return { name, type, ...attrs };
	});
}
export function genericParameters(c) {
	if (c.peek() !== "<") return [];
	return split(c.group("<")).map((p) => {
		if (p.length === 1) return { name: p[0], constraint: null };
		if (p[0] === "const" && p[2] === ":")
			return { name: p[1], constraint: p[3] === "bool" ? "boolean" : /^u\d+$/.test(p[3]) ? "number" : null };
		throw Error("unsupported Rust generic parameter");
	});
}
