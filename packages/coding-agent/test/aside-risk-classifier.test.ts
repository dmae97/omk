import { describe, expect, it } from "vitest";
import { classifyRisk } from "../examples/extensions/aside-computer-use/risk-classifier.ts";
import type { BrowserAction } from "../examples/extensions/aside-computer-use/types.ts";

function act(
	kind: string,
	description = "",
	url?: string,
	asideArgs?: Readonly<Record<string, unknown>>,
): BrowserAction {
	return { kind, description, url, asideArgs };
}

describe("classifyRisk", () => {
	it("classifies read-only observation as R0", () => {
		expect(classifyRisk(act("screenshot"))).toBe("R0");
		expect(classifyRisk(act("read_text"))).toBe("R0");
		expect(classifyRisk(act("scroll"))).toBe("R0");
		expect(classifyRisk(act("inspect"))).toBe("R0");
	});

	it("classifies reversible interaction as R1", () => {
		expect(classifyRisk(act("open_page"))).toBe("R1");
		expect(classifyRisk(act("fill_form"))).toBe("R1");
		expect(classifyRisk(act("click_locator"))).toBe("R1");
		expect(classifyRisk(act("download"))).toBe("R1");
	});

	it("classifies external mutation as R2", () => {
		expect(classifyRisk(act("submit"))).toBe("R2");
		expect(classifyRisk(act("send_message"))).toBe("R2");
		expect(classifyRisk(act("create_issue"))).toBe("R2");
		expect(classifyRisk(act("comment"))).toBe("R2");
	});

	it("classifies critical mutation as R3", () => {
		expect(classifyRisk(act("delete"))).toBe("R3");
		expect(classifyRisk(act("payment"))).toBe("R3");
		expect(classifyRisk(act("account_deletion"))).toBe("R3");
	});

	it("normalizes separator variants before matching critical verbs", () => {
		expect(classifyRisk(act("click", "delete_account"))).toBe("R3");
		expect(classifyRisk(act("click", "delete-account"))).toBe("R3");
		expect(classifyRisk(act("click", "delete account"))).toBe("R3");
	});

	it("promotes wallet, security, payment, and API-key actions to R3", () => {
		expect(classifyRisk(act("click", "connect wallet"))).toBe("R3");
		expect(classifyRisk(act("click", "open security settings"))).toBe("R3");
		expect(classifyRisk(act("click", "Pay now"))).toBe("R3");
		expect(classifyRisk(act("click", "copy api key"))).toBe("R3");
	});

	it("uses asideArgs metadata for sensitive typing and API-key targets", () => {
		expect(
			classifyRisk(
				act("type", "fill field", undefined, {
					inputType: "password",
					autocomplete: "current-password",
					name: "user_password",
				}),
			),
		).toBe("R3");
		expect(classifyRisk(act("click", "copy", undefined, { ariaLabel: "Copy API key" }))).toBe("R3");
	});

	it("promotes Enter in form and OAuth initiation to R2", () => {
		expect(classifyRisk(act("press_key", "Enter in form", undefined, { key: "Enter", form: true }))).toBe("R2");
		expect(classifyRisk(act("click", "Continue with OAuth"))).toBe("R2");
	});

	it("promotes by description verbs (submit beats baseline)", () => {
		expect(classifyRisk(act("click", "submit the form"))).toBe("R2");
		expect(classifyRisk(act("click", "delete account"))).toBe("R3");
	});

	it("defaults unknown kinds to R1", () => {
		expect(classifyRisk(act("something_new"))).toBe("R1");
	});

	it("R3 verb always wins over R2 verb", () => {
		expect(classifyRisk(act("submit", "wire transfer funds"))).toBe("R3");
	});
});
