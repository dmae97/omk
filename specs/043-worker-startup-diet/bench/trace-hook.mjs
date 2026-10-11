// Records every module URL loaded (ESM + CJS via module.registerHooks), writes on exit.
import { registerHooks } from "node:module";
import { writeFileSync } from "node:fs";
const seen = new Map();
const t0 = performance.now();
registerHooks({
	load(url, context, nextLoad) {
		const s = performance.now();
		const r = nextLoad(url, context);
		if (!seen.has(url)) seen.set(url, { t: performance.timeOrigin + s, loadMs: performance.now() - s, format: r.format });
		return r;
	},
});
process.on("exit", () => {
	const out = process.env.TRACE_OUT;
	if (!out) return;
	writeFileSync(out, [...seen].map(([u, v]) => `${v.t.toFixed(1)}\t${v.format}\t${u}`).join("\n") + "\n");
});
