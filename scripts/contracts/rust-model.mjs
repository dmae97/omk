import {
	Cursor,
	tokens,
	attributes,
	fields,
	genericParameters,
	typeExpression,
	split,
	literal,
} from "./rust-syntax.mjs";

function usePaths(parts, prefix = []) {
	const group = parts.indexOf("{");
	if (group >= 0) {
		const head = parts.slice(0, group).filter((x) => x !== "::");
		return split(parts.slice(group + 1, -1)).flatMap((p) => usePaths(p, [...prefix, ...head]));
	}
	if (parts.includes("as")) throw Error("unsupported Rust use alias");
	return [[...prefix, ...parts.filter((x) => x !== "::")]];
}
function skipBody(c) {
	while (c.peek() !== undefined) {
		if (c.peek() === "{") {
			c.group();
			return;
		}
		if (c.take() === ";") return;
	}
	throw Error("unterminated Rust item");
}
export function parseModule(source) {
	const c = new Cursor(tokens(source));
	const model = { types: new Map(), uses: [], mods: [], impls: [], functions: new Map(), constants: new Map() };
	while (c.peek() !== undefined) {
		const attrs = attributes(c);
		let pub = false;
		if (c.peek() === "pub") {
			pub = true;
			c.take();
			if (c.peek() === "(") {
				c.group();
				pub = false;
			}
		}
		const start = c.i;
		let kind = c.take();
		if (kind === "use") {
			model.uses.push(...usePaths(c.until(";")).map((path) => ({ path, pub })));
			c.take(";");
			continue;
		}
		if (kind === "mod") {
			const name = c.take();
			c.take(";");
			model.mods.push({ name, path: attrs.path, pub });
			continue;
		}
		if (kind === "impl") {
			const header = c.until("{");
			const body = c.group("{");
			const h = new Cursor(header);
			if (h.peek() === "<") h.group("<");
			const rest = header.slice(h.i);
			const at = rest.indexOf("for");
			const trait = at < 0 ? "inherent" : rest[0];
			const target = (at < 0 ? rest : rest.slice(at + 1)).find((t) => /^[A-Z][A-Za-z_0-9]*$/.test(t));
			model.impls.push({ trait, target, body, canonical: JSON.stringify(["impl", ...header, "{", ...body, "}"]) });
			continue;
		}
		if (kind === "const" && c.peek() === "fn") {
			kind = c.take();
		}
		if (kind === "fn") {
			const name = c.peek();
			skipBody(c);
			model.functions.set(name, JSON.stringify(c.items.slice(start, c.i)));
			continue;
		}
		if (kind === "const") {
			const name = c.take();
			const begin = c.i;
			while (c.peek() !== ";" && c.peek() !== undefined) {
				if (["(", "[", "{", "<"].includes(c.peek())) c.group();
				else c.take();
			}
			const declaration = c.items.slice(begin, c.i);
			c.take(";");
			const equal = declaration.indexOf("=");
			const value = declaration.slice(equal + 1);
			if (pub && value.length === 1 && /^\d[\d_]*$/.test(value[0]))
				model.constants.set(name, Number(value[0].replaceAll("_", "")));
			continue;
		}
		if (!["struct", "enum", "type"].includes(kind)) throw Error(`unsupported Rust item: ${kind}`);
		const name = c.take();
		const generics = genericParameters(c);
		const item = { name, kind, pub, generics, ...attrs };
		if (kind === "type") {
			c.take("=");
			item.type = typeExpression(c.until(";"));
			c.take(";");
		} else if (kind === "struct") {
			item.style = c.peek() === "{" ? "named" : c.peek() === "(" ? "tuple" : "unit";
			item.fields = item.style === "unit" ? [] : fields(c.group(), item.style === "named");
			if (c.peek() === ";") c.take();
		} else {
			item.variants = split(c.group("{")).map((part) => {
				const v = new Cursor(part);
				const a = attributes(v);
				const name = v.take();
				const style = v.peek() === "{" ? "named" : v.peek() === "(" ? "tuple" : "unit";
				const f = style === "unit" ? [] : fields(v.group(), style === "named");
				if (v.peek() !== undefined) throw Error("unsupported Rust enum discriminant");
				return { name, style, fields: f, ...a };
			});
		}
		if (model.types.has(name)) throw Error(`duplicate Rust type ${name}`);
		model.types.set(name, item);
	}
	return model;
}
export function buildModel(bundle) {
	if (bundle?.schema !== "omk.contract.sources.v1" || !bundle.files || typeof bundle.generator !== "string")
		throw Error("unsupported Rust catalog");
	const modules = new Map();
	const visit = (id, file) => {
		if (modules.has(id)) throw Error("duplicate Rust module");
		if (!/^[a-z_]+\.rs$/.test(file) || typeof bundle.files[file] !== "string")
			throw Error("unsupported Rust module path");
		const module = { id, file, ...parseModule(bundle.files[file]) };
		modules.set(id, module);
		for (const child of module.mods) {
			const childId = id === "lib" ? child.name : `${id}::${child.name}`;
			visit(childId, child.path ?? `${child.name}.rs`);
		}
	};
	visit("lib", "lib.rs");
	return { bundle, modules };
}
export function absolutePath(module, path) {
	let rest = [...path];
	let prefix = module.id === "lib" ? [] : module.id.split("::");
	if (rest[0] === "crate") {
		prefix = [];
		rest.shift();
	} else if (rest[0] === "self") rest.shift();
	else
		while (rest[0] === "super") {
			prefix.pop();
			rest.shift();
		}
	return [...prefix, ...rest];
}
export function resolveType(model, module, path, seen = new Set()) {
	const key = module.id + ":" + path.join("::");
	if (seen.has(key)) throw Error("cyclic Rust type import");
	seen.add(key);
	if (path.length === 1 && module.types.has(path[0])) return { module, item: module.types.get(path[0]) };
	if (path.length === 1) {
		for (const use of module.uses) {
			if (use.path.at(-1) === path[0]) return resolveAbsolute(model, absolutePath(module, use.path), seen);
		}
		for (const use of module.uses.filter((u) => u.path.at(-1) === "*")) {
			const parent = absolutePath(module, use.path.slice(0, -1)).join("::") || "lib";
			const candidate = model.modules.get(parent);
			if (candidate?.types.has(path[0])) return { module: candidate, item: candidate.types.get(path[0]) };
		}
	}
	if (path.length === 1) throw Error(`unresolved Rust type ${module.id}::${path[0]}`);
	return resolveAbsolute(model, absolutePath(module, path), seen);
}
function resolveAbsolute(model, path, seen) {
	const name = path.at(-1);
	const id = path.slice(0, -1).join("::") || "lib";
	const m = model.modules.get(id);
	if (!m) throw Error(`unresolved Rust type ${path.join("::")}`);
	return resolveType(model, m, [name], seen);
}
export function wireName(name, rename, kind = "variant") {
	if (!rename) return name;
	if (kind === "field") {
		if (rename === "snake_case" || rename === "lowercase") return name;
		if (rename === "camelCase") {
			const pascal = name
				.split("_")
				.filter(Boolean)
				.map((s) => s[0].toUpperCase() + s.slice(1))
				.join("");
			return pascal[0].toLowerCase() + pascal.slice(1);
		}
	} else {
		if (rename === "snake_case") return name.replace(/[A-Z]/g, (s, i) => (i ? "_" : "") + s.toLowerCase());
		if (rename === "camelCase") return name[0].toLowerCase() + name.slice(1);
		if (rename === "lowercase") return name.toLowerCase();
	}
	throw Error(`unsupported serde rename rule: ${rename}`);
}
export { literal };
