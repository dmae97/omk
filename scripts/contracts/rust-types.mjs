import { resolveType, wireName } from "./rust-model.mjs";
export const fileName = (id) => id.replaceAll("::", "-").replaceAll("_", "-") + ".ts";
// One flat namespace in wire.generated.ts keeps mutually recursive Rust modules acyclic in TypeScript.
export const wireIdent = (id, name) => id.replaceAll("::", "$") + "$" + name;
export const isWire = (module, item) =>
	item.pub &&
	(item.kind === "type" ||
		item.derive.includes("Serialize") ||
		item.derive.includes("Deserialize") ||
		module.impls.some((i) => i.target === item.name && ["Serialize", "Deserialize"].includes(i.trait)));
export function context(model, module, generics = []) {
	const reference = (owner, name) => wireIdent(owner.id, name);
	const json = () => "JsonValue";
	const type = (t) => {
		if (t.tuple) return "[" + t.tuple.map(type).join(", ") + "]";
		const name = t.path.at(-1);
		const args = t.args ?? [];
		if (t.path.length === 1 && generics.includes(name)) return name;
		if (t.path.length === 1 && /^(?:true|false|\d[\d_]*)$/.test(name)) return name.replaceAll("_", "");
		const imported = module.uses.find((u) => u.path.at(-1) === name);
		const origin = t.path.length > 1 ? t.path : imported?.path;
		const standard = new Set([
			"std::string::String",
			"std::boxed::Box",
			"std::vec::Vec",
			"std::option::Option",
			"std::collections::BTreeMap",
			"serde_json::Map",
			"serde_json::Number",
			"serde_json::Value",
			"serde_json::value::RawValue",
		]);
		const builtin = origin
			? standard.has(origin.join("::"))
			: ["String", "str", "bool", "Box", "Vec", "Option"].includes(name) || /^(?:[ui]\d+|[ui]size|f\d+)$/.test(name);
		if (builtin && (t.path.length > 1 || !module.types.has(name))) {
			if (args.length && !["Box", "Vec", "Option", "Map", "BTreeMap"].includes(name))
				throw Error("unsupported primitive generic type");
			if (name === "String" || name === "str") return "string";
			if (name === "bool") return "boolean";
			if (/^(?:[ui]\d+|[ui]size|f\d+)$/.test(name) || name === "Number") return "number";
			if (name === "Value" || name === "RawValue") return json();
			if (name === "Box" && args.length === 1) return type(args[0]);
			if (name === "Vec" && args.length === 1) return `Array<${type(args[0])}>`;
			if (name === "Option" && args.length === 1) return `(${type(args[0])} | null)`;
			if (["Map", "BTreeMap"].includes(name) && args.length === 2)
				return `Record<${type(args[0])}, ${type(args[1])}>`;
		}
		const target = resolveType(model, module, t.path);
		if (!isWire(target.module, target.item)) throw Error(`unsupported non-wire Rust type ${name}`);
		return reference(target.module, target.item.name) + (args.length ? "<" + args.map(type).join(", ") + ">" : "");
	};
	const fieldType = (f) => {
		if (
			f.serde.skip_serializing_if &&
			!["Option::is_none", "Optional::is_absent"].includes(f.serde.skip_serializing_if)
		)
			throw Error("unsupported serde skip helper");
		const name = f.type.path?.at(-1);
		const optional = (name === "Optional" || name === "Option") && f.serde.default && f.serde.skip_serializing_if;
		if (f.serde.deserialize_with === "present_true") return { text: "true", optional: !!optional };
		return { text: type(optional ? f.type.args[0] : f.type), optional: !!optional };
	};
	const shape = (fields, rename) => {
		const normal = [];
		const flat = [];
		for (const f of fields) {
			if (f.serde.flatten) {
				flat.push(type(f.type));
				continue;
			}
			const value = fieldType(f);
			const name = f.serde.rename ?? wireName(f.name, rename, "field");
			normal.push(`${JSON.stringify(name)}${value.optional ? "?" : ""}: ${value.text};`);
		}
		const members = normal.length ? ["{ " + normal.join(" ") + " }"] : flat.length ? [] : ["Record<never, never>"];
		return [...members, ...flat.map((v) => "(" + v + ")")].join(" & ");
	};
	return { type, shape, fieldType, reference };
}
export function normalType(item, ctx) {
	if (item.serde.default) throw Error("unsupported serde container default");
	if (item.kind === "type") return ctx.type(item.type);
	if (item.kind === "struct") {
		if (item.serde.transparent) {
			if (item.fields.length !== 1) throw Error("unsupported transparent shape");
			return ctx.type(item.fields[0].type);
		}
		if (item.style === "named") return ctx.shape(item.fields, item.serde.rename_all);
		if (item.fields.length === 1) return ctx.type(item.fields[0].type);
		if (item.style === "tuple") return "[" + item.fields.map((f) => ctx.type(f.type)).join(", ") + "]";
		return "null";
	}
	const variants = item.variants.map((v) => {
		const name = v.serde.rename ?? wireName(v.name, item.serde.rename_all);
		const payload =
			v.style === "named"
				? ctx.shape(v.fields, v.serde.rename_all ?? item.serde.rename_all_fields)
				: v.fields.length === 1
					? ctx.type(v.fields[0].type)
					: "[" + v.fields.map((f) => ctx.type(f.type)).join(", ") + "]";
		if (item.serde.untagged) return v.style === "unit" ? "null" : "(" + payload + ")";
		if (item.serde.tag) {
			const tag = `{ ${JSON.stringify(item.serde.tag)}: ${JSON.stringify(name)}; }`;
			if (v.style === "unit") return tag;
			if (item.serde.content)
				return `{ ${JSON.stringify(item.serde.tag)}: ${JSON.stringify(name)}; ${JSON.stringify(item.serde.content)}: ${payload}; }`;
			if (v.style === "tuple" && v.fields.length !== 1) throw Error("unsupported internally tagged tuple");
			return tag + " & (" + payload + ")";
		}
		return v.style === "unit" ? JSON.stringify(name) : `{ ${JSON.stringify(name)}: ${payload}; }`;
	});
	return variants.join(" | ");
}
