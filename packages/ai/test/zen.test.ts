import { MODELS } from "@oh-my-pi/pi-ai/models.generated";
import { complete } from "@oh-my-pi/pi-ai/stream";
import type { Model } from "@oh-my-pi/pi-ai/types";
import { describe, expect, it } from "vitest";

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
