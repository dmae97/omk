import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExtensionModuleWithVirtualModulesForTests, loadExtensions } from "../src/core/extensions/loader.ts";

describe("Pi provider factory compatibility", () => {
	let directory: string;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "omk-pi-provider-"));
	});

	afterEach(() => {
		fs.rmSync(directory, { recursive: true, force: true });
	});

	for (const namespace of ["@earendil-works", "@mariozechner"]) {
		it(`loads ${namespace}/pi-ai/compat through Node and Bun aliases`, async () => {
			const extension = path.join(directory, "provider.ts");
			fs.writeFileSync(
				extension,
				`
					import { openAIResponsesApi } from "${namespace}/pi-ai/compat";
					const { api, streamSimple } = openAIResponsesApi();
					if (api !== "openai-responses" || typeof streamSimple !== "function") {
						throw new Error("missing Responses compatibility factory");
					}
					export default function(pi) {
						pi.registerProvider("compat-fixture", { api, streamSimple });
					}
				`,
			);

			// Pi provider factory compatibility is an explicit opt-in since OMK 2.0.
			const result = await loadExtensions([extension], directory, undefined, { packageManifestDialect: "omk+pi" });
			expect(result.errors).toEqual([]);
			expect(result.extensions).toHaveLength(1);
			expect(result.runtime.pendingProviderRegistrations[0]?.name).toBe("compat-fixture");
			expect(
				await loadExtensionModuleWithVirtualModulesForTests(extension, { packageManifestDialect: "omk+pi" }),
			).toBeTypeOf("function");
		});
	}
});
