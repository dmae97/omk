#!/usr/bin/env node
import { parseArgs } from "node:util";
import { auditBenchmark } from "./lib/tb21-audit.mjs";
import { AuditError } from "./lib/tb21-input.mjs";

function options() {
	try {
		const { values, tokens } = parseArgs({
			options: { manifest: { type: "string" }, "expect-manifest-sha256": { type: "string" } },
			strict: true,
			allowPositionals: false,
			tokens: true,
		});
		const names = tokens.filter((token) => token.kind === "option").map((token) => token.name);
		if (new Set(names).size !== names.length || !values.manifest || !values["expect-manifest-sha256"]) {
			throw new AuditError("invalid_options");
		}
		return { manifest: values.manifest, digest: values["expect-manifest-sha256"] };
	} catch {
		throw new AuditError("invalid_options");
	}
}

try {
	const input = options();
	const report = auditBenchmark(input.manifest, input.digest);
	console.log(JSON.stringify(report, null, 2));
} catch (error) {
	// CLI boundary: never echo untrusted JSON, paths, provider errors, or parser source snippets.
	const code = error instanceof AuditError ? error.code : "internal_error";
	console.error(JSON.stringify({ status: "incomplete", code }));
	process.exitCode = code === "invalid_options" || code === "invalid_manifest" ? 2 : 1;
}
