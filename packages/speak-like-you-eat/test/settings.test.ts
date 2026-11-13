import type { ExtensionCommandContext } from "open-multi-agent-kit";
import { describe, expect, it, vi } from "vitest";
import { chooseAndSaveModel } from "../src/settings.ts";

describe("legacy host model scopes", () => {
	it.each([false, true])("handles an absent scope with authenticated models: %s", async (available) => {
		const model = { provider: "test", id: "plain", name: "Plain", reasoning: false };
		const notify = vi.fn();
		const custom = vi.fn().mockResolvedValue(undefined);
		const ctx = {
			modelRegistry: {
				getAvailable: () => (available ? [model] : []),
				hasConfiguredAuth: () => true,
			},
			ui: { notify, custom },
		} as unknown as ExtensionCommandContext;
		await expect(chooseAndSaveModel(ctx, "/unused", false)).resolves.toBeUndefined();
		if (available) {
			expect(custom).toHaveBeenCalledOnce();
			expect(notify).not.toHaveBeenCalled();
		} else {
			expect(custom).not.toHaveBeenCalled();
			expect(notify).toHaveBeenCalledWith("No authenticated models are available for SLYE.", "warning");
		}
	});
});
