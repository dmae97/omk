import { Text } from "omk-tui";
import { describe, expect, it } from "vitest";
import type { EntryRenderer } from "../src/core/extensions/types.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { CustomEntryComponent } from "../src/modes/interactive/components/custom-entry.ts";

describe("display-only custom entries", () => {
	it("renders persisted companion data without adding it to the LLM context", () => {
		const session = SessionManager.inMemory();
		const id = session.appendCustomEntry("slye.rewrite", { display: "Plain companion" });
		const entry = session.getEntry(id);
		if (!entry || entry.type !== "custom") throw new Error("custom entry fixture missing");
		expect(session.buildSessionContext().messages).toEqual([]);
		const renderer: EntryRenderer = (value) => {
			const data = value.data as { display: string };
			return new Text(data.display, 0, 0);
		};
		const component = new CustomEntryComponent(entry, renderer);
		expect(component.render(80).join("\n")).toContain("Plain companion");
	});
	it("keeps malformed renderer output and exceptions out of the transcript", () => {
		const session = SessionManager.inMemory();
		const id = session.appendCustomEntry("broken", { display: "hidden" });
		const entry = session.getEntry(id);
		if (!entry || entry.type !== "custom") throw new Error("custom entry fixture missing");
		expect(new CustomEntryComponent(entry, () => undefined).render(80)).toEqual([]);
		expect(
			new CustomEntryComponent(entry, () => {
				throw new Error("broken renderer");
			}).render(80),
		).toEqual([]);
	});
});
