import * as fc from "fast-check";
import { expect, it } from "vitest";
import { adjudicate } from "../src/adjudicator.ts";
import { createVerifierRegistry } from "../src/adjudicator-registry.ts";
import { createInMemoryAdaptOrchClient } from "../src/in-memory-adaptorch.ts";

it("never manufactures confirmation from arbitrary introspection payloads", async () => {
	await fc.assert(
		fc.asyncProperty(fc.jsonValue(), fc.jsonValue(), fc.jsonValue(), async (fields, artifacts, traces) => {
			const run = {
				run_id: "synthetic-property-run",
				status: "SUCCEEDED",
				...(typeof fields === "object" && fields !== null && !Array.isArray(fields) ? fields : {}),
			};
			const client = createInMemoryAdaptOrchClient({ "synthetic-property-run": { run, artifacts, traces } });
			const result = await adjudicate(
				{ dispatch_record_id: "synthetic-d", kind: "review", run_ids: ["synthetic-property-run"] },
				client,
				createVerifierRegistry([]),
			);
			expect(result.verdict).not.toBe("CONFIRMED");
		}),
		{ seed: 20261004, numRuns: 200 },
	);
});
