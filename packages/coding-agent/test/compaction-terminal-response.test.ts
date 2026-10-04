import { fauxAssistantMessage, registerFauxProvider } from "omk-ai";
import { describe, expect, it } from "vitest";
import { generateSummary } from "../src/core/compaction/compaction.ts";

describe("compaction terminal response contract", () => {
	it.each(["", "   \n\t"])("rejects an empty normal-stop summary %#", async (text) => {
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage(text)]);
		try {
			await expect(
				generateSummary([{ role: "user", content: "fixture", timestamp: 0 }], faux.getModel(), 256, "faux-key"),
			).rejects.toThrow(/empty summary/);
		} finally {
			faux.unregister();
		}
	});

	it.each(["", "partial summary"])(
		"preserves an aborted completion instead of publishing its text %#",
		async (text) => {
			const faux = registerFauxProvider();
			faux.setResponses([fauxAssistantMessage(text, { stopReason: "aborted" })]);
			try {
				await expect(
					generateSummary([{ role: "user", content: "fixture", timestamp: 0 }], faux.getModel(), 256, "faux-key"),
				).rejects.toMatchObject({ name: "AbortError" });
			} finally {
				faux.unregister();
			}
		},
	);

	it("does not treat a tool-use stop as completed summarization", async () => {
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("not a terminal summary", { stopReason: "toolUse" })]);
		try {
			await expect(
				generateSummary([{ role: "user", content: "fixture", timestamp: 0 }], faux.getModel(), 256, "faux-key"),
			).rejects.toThrow(/stop reason/);
		} finally {
			faux.unregister();
		}
	});

	it("retains the existing nonempty length-stop contract", async () => {
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("usable bounded summary", { stopReason: "length" })]);
		try {
			expect(
				await generateSummary(
					[{ role: "user", content: "fixture", timestamp: 0 }],
					faux.getModel(),
					256,
					"faux-key",
				),
			).toBe("usable bounded summary");
		} finally {
			faux.unregister();
		}
	});
});
