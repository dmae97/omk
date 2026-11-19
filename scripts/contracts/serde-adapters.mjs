import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Cursor, split, literal } from "./rust-syntax.mjs";
import { resolveType, wireName } from "./rust-model.mjs";
const digest = (text) => createHash("sha256").update(text).digest("hex");
const pins = JSON.parse(readFileSync(new URL("./serde-adapters.json", import.meta.url), "utf8"));
export function adapterSignatures(model) {
	const result = {};
	for (const module of model.modules.values()) {
		const manual = new Set(
			module.impls
				.filter((i) => ["Serialize", "Deserialize", "TryFrom", "From"].includes(i.trait))
				.map((i) => i.target),
		);
		const counts = {};
		for (const impl of module.impls) {
			if (
				!["Serialize", "Deserialize", "TryFrom", "From"].includes(impl.trait) &&
				!(impl.trait === "inherent" && manual.has(impl.target))
			)
				continue;
			const base = `${module.id}::${impl.target}/${impl.trait}`;
			const index = counts[base] ?? 0;
			counts[base] = index + 1;
			result[`${base}/${index}`] = digest(impl.canonical);
		}
	}
	const helpers = new Set();
	for (const module of model.modules.values())
		for (const item of module.types.values()) {
			const fields = [...(item.fields ?? []), ...(item.variants ?? []).flatMap((v) => v.fields)];
			for (const field of fields) if (field.serde.deserialize_with) helpers.add(field.serde.deserialize_with);
		}
	for (const name of helpers) {
		const owners = [...model.modules.values()].filter((m) => m.functions.has(name));
		if (owners.length !== 1) throw Error(`unsupported serde helper ${name}`);
		result[`${owners[0].id}::${name}/fn`] = digest(owners[0].functions.get(name));
	}
	return result;
}
export function validateAdapters(model) {
	const actual = adapterSignatures(model);
	for (const key of new Set([...Object.keys(actual), ...Object.keys(pins)]))
		if (actual[key] !== pins[key]) throw Error(`serde adapter requires review: ${key}`);
}
function causeCodes(module) {
	const body = module.impls.find((i) => i.target === "CauseCode" && i.trait === "TryFrom").body;
	const c = new Cursor(body.slice(body.indexOf("match") + 1));
	c.until("{");
	const arms = split(c.group("{"));
	const values = [];
	for (const arm of arms) {
		const arrow = arm.indexOf("=>");
		const pattern = arm.slice(0, arrow);
		let expression = arm.slice(arrow + 1);
		if (pattern[0] === "_") continue;
		const names = pattern.filter((t) => t.startsWith('"')).map(literal);
		if (expression[0] === "{") expression = expression.slice(1, -1);
		if (expression[0] === "true") {
			for (let i = 0; i < names.length; i += 2) values.push(`${names[i]}.${names[i + 1]}`);
		} else if (expression[0] === "matches") {
			for (const suffix of expression.filter((t) => t.startsWith('"')).map(literal))
				values.push(`${names[0]}.${suffix}`);
		} else throw Error("unsupported termination cause adapter");
	}
	return values.map(JSON.stringify).join(" | ");
}
export function customType(model, module, item, ctx) {
	const key = module.id + "::" + item.name;
	const parameter = item.generics[0]?.name;
	if (key === "rpc::Optional") return `${parameter} | null`;
	if (key === "rpc::Bool" || key === "rpc::Version") return parameter;
	if (key === "rpc::Open")
		return `${parameter} & ${ctx.type({ path: ["crate", "session", "ExtraFields"], args: [] })}`;
	if (key === "jsonl::JsonRecord") return parameter;
	if (key === "rpc::status::CauseCode") return causeCodes(module);
	if (key === "session_message::SessionMessage") {
		const known = item.variants.find((v) => v.name === "Known");
		const extension = item.variants.find((v) => v.name === "Extension");
		return `${ctx.type(known.fields[0].type)} | (${ctx.type(extension.fields[0].type)} & { role: string })`;
	}
	if (["rpc::stream::Assistant", "rpc::stream::ToolResult"].includes(key)) {
		const impl = module.impls.find((i) => i.target === item.name && i.trait === "Deserialize");
		const known = resolveType(model, module, ["KnownMessage"]).item;
		const at = impl.body.findIndex(
			(t, i) =>
				t === "KnownMessage" &&
				impl.body[i + 1] === "::" &&
				known.variants.some((v) => v.name === impl.body[i + 2]),
		);
		const variant = impl.body[at + 2];
		if (at < 0) throw Error("unsupported message role adapter");
		return `Extract<${ctx.type(item.fields[0].type)}, { ${JSON.stringify(known.serde.tag)}: ${JSON.stringify(known.variants.find((v) => v.name === variant).serde.rename ?? wireName(variant, known.serde.rename_all))} }>`;
	}
	if (key === "rpc::ui::RpcUiResponse") {
		const target = resolveType(model, module, item.fields[0].type.path);
		const impl = module.impls.find((i) => i.target === item.name && i.trait === "Deserialize");
		const names = impl.body.filter(
			(t, i) =>
				impl.body[i - 2] === "fields" &&
				impl.body[i - 1] === "." &&
				impl.body[i + 1] === "." &&
				impl.body[i + 2] === "is_absent",
		);
		const alternatives = names.map((name) => {
			const f = target.item.fields.find((f) => f.name === name);
			return `{ ${JSON.stringify(wireName(name, target.item.serde.rename_all, "field"))}: ${ctx.type(f.type.args[0])} }`;
		});
		return `${ctx.type(item.fields[0].type)} & (${alternatives.join(" | ")})`;
	}
	return null;
}
