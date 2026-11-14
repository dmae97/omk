#!/usr/bin/env node
import { parseArgs } from "node:util";
import { AuditError } from "./lib/tb21-input.mjs";
import { auditRepeatedBenchmark } from "./lib/tb21-repeat-audit.mjs";

try {
	let input;
	try {
		const { values, tokens } = parseArgs({
			options: { manifest: { type: "string" }, "expect-manifest-sha256": { type: "string" } },
			strict: true, allowPositionals: false, tokens: true,
		});
		const names = tokens.filter(token => token.kind === "option").map(token => token.name);
		if (new Set(names).size !== names.length || !values.manifest || !values["expect-manifest-sha256"]) throw new AuditError("invalid_options");
		input = { path: values.manifest, digest: values["expect-manifest-sha256"] };
	} catch { throw new AuditError("invalid_options"); }
	console.log(JSON.stringify(auditRepeatedBenchmark(input.path, input.digest), null, 2));
} catch (error) {
	const code = error instanceof AuditError ? error.code : "internal_error";
	console.error(JSON.stringify({ status: "incomplete", code }));
	process.exitCode = code === "invalid_options" || code === "invalid_manifest" ? 2 : 1;
}
