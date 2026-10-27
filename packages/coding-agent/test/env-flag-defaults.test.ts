import { describe, expect, it } from "vitest";
import { isDefaultOnEnvFlag, isEnvFlagOptOut } from "../src/core/env-flag.ts";
import { EDIT_DIAGNOSTICS_ENV, editDiagnosticsMode } from "../src/core/tools/edit-diagnostics.ts";

describe("default-on env flags (OMK_EDIT_DIAGNOSTICS, OMK_EXEC_TRUNCATE_MIDDLE, OMK_JSON_SESSION_INFO)", () => {
	it("only 0/false/off (case-insensitive, trimmed) opt out", () => {
		for (const v of ["0", "false", "off", "FALSE", " Off ", "0 "]) expect(isEnvFlagOptOut(v)).toBe(true);
		for (const v of [undefined, "", "1", "true", "on", "yes", "shadow"]) expect(isDefaultOnEnvFlag(v)).toBe(true);
	});

	it("OMK_EDIT_DIAGNOSTICS: unset = on, shadow kept, opt-out = off", () => {
		expect(editDiagnosticsMode({})).toBe("on");
		expect(editDiagnosticsMode({ [EDIT_DIAGNOSTICS_ENV]: "" })).toBe("on");
		expect(editDiagnosticsMode({ [EDIT_DIAGNOSTICS_ENV]: "1" })).toBe("on");
		expect(editDiagnosticsMode({ [EDIT_DIAGNOSTICS_ENV]: "shadow" })).toBe("shadow");
		for (const v of ["0", "false", "off", "OFF"])
			expect(editDiagnosticsMode({ [EDIT_DIAGNOSTICS_ENV]: v })).toBe("off");
	});
});
