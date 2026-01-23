import { describe, expect, it } from "vitest";
import { MODELS } from "$ai/models.generated";
import { complete } from "$ai/stream";
import type { Model } from "$ai/types";

describe.skipIf(!process.env.OPENCODE_API_KEY)("OpenCode Zen Models Smoke Test", () => {
	const zenModels = Object.values(MODELS.opencode);

	zenModels.forEach((model) => {
		it(`${model.id}`, async () => {
			const response = await complete(model as Model<any>, {
				messages: [{ role: "user", content: "Say hello.", timestamp: Date.now() }],
			});

			expect(response.content).toBeTruthy();
			expect(response.stopReason).toBe("stop");
		}, 60000);
	});
});
