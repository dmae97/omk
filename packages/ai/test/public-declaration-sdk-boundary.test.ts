import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(packageRoot, "src");

/** Emit the root entry's declarations in memory and return them keyed by path relative to src/. */
function emitRootDeclarations(): Map<string, string> {
	const config = ts.getParsedCommandLineOfConfigFile(
		join(packageRoot, "tsconfig.build.json"),
		{},
		{
			...ts.sys,
			onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
				throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
			},
		},
	);
	if (!config) throw new Error("tsconfig.build.json could not be parsed");
	const options: ts.CompilerOptions = {
		...config.options,
		noEmit: false,
		declaration: true,
		emitDeclarationOnly: true,
		declarationMap: false,
		sourceMap: false,
		outDir: join(packageRoot, ".declaration-boundary-not-written"),
	};
	const program = ts.createProgram([join(srcRoot, "index.ts")], options);
	const declarations = new Map<string, string>();
	const result = program.emit(undefined, (fileName, text) => {
		if (fileName.endsWith(".d.ts")) declarations.set(relative(options.outDir!, fileName), text);
	});
	if (result.emitSkipped) throw new Error("declaration emit skipped");
	return declarations;
}

function specifiers(text: string): string[] {
	return [...text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1]);
}

/** Declarations reachable from index.d.ts that import a non-relative specifier from `packages`. */
function reachableSdkImports(declarations: Map<string, string>, packages: string[]): Record<string, string[]> {
	const seen = new Set<string>();
	const pending = ["index.d.ts"];
	const found: Record<string, string[]> = {};
	while (pending.length > 0) {
		const file = pending.pop()!;
		if (seen.has(file)) continue;
		seen.add(file);
		const text = declarations.get(file);
		if (text === undefined) throw new Error(`reachable declaration was not emitted: ${file}`);
		for (const specifier of specifiers(text)) {
			if (specifier.startsWith(".")) {
				pending.push(join(dirname(file), specifier).replace(/\.(?:ts|js)$/, ".d.ts"));
			} else if (packages.some((name) => specifier === name || specifier.startsWith(`${name}/`))) {
				found[file] = [...(found[file] ?? []), specifier];
			}
		}
	}
	return found;
}

describe("omk-ai root declaration boundary", () => {
	it("keeps provider SDK declarations out of the root entry, except the documented Anthropic client option", () => {
		const declarations = emitRootDeclarations();
		const sdkImports = reachableSdkImports(declarations, ["@anthropic-ai/sdk", "@google/genai"]);
		// AnthropicOptions.client is public API typed as the SDK client. @anthropic-ai/sdk 0.91.1
		// declarations failed strict consumers (skipLibCheck: false); 0.92.0, now pinned, fixes them.
		// The client type is re-exported from anthropic-client.ts, beside the OMK header-policy subclass.
		// Any new SDK edge from the root entry must be reviewed, not silently added.
		expect(sdkImports).toEqual({ "providers/anthropic-client.d.ts": ["@anthropic-ai/sdk"] });
	}, 180_000);
});
