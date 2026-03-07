import { describe, expect, it } from "bun:test";
import { matchesKey, parseKey, setKittyProtocolActive } from "@oh-my-pi/pi-tui/keys";

describe("matchesKey", () => {
	it("matches ctrl+letter sequences", () => {
		setKittyProtocolActive(false);
		const ctrlC = String.fromCharCode(3);
		expect(matchesKey(ctrlC, "ctrl+c")).toBe(true);
	});

	it("matches shifted tab", () => {
		setKittyProtocolActive(false);
		expect(matchesKey("\x1b[Z", "shift+tab")).toBe(true);
	});

	it("matches pageUp legacy sequence with mixed case keyId", () => {
		setKittyProtocolActive(false);
		expect(matchesKey("\x1b[5~", "pageUp")).toBe(true);
	});

	it("should prefer codepoint for Latin letters even when base layout differs", () => {
		setKittyProtocolActive(true);
		// Dvorak Ctrl+K reports codepoint 'k' (107) and base layout 'v' (118)
		const dvorakCtrlK = "\x1b[107::118;5u";
		expect(matchesKey(dvorakCtrlK, "ctrl+k")).toBe(true);
		expect(matchesKey(dvorakCtrlK, "ctrl+v")).toBe(false);
		setKittyProtocolActive(false);
	});

	it("should prefer codepoint for symbol keys even when base layout differs", () => {
		setKittyProtocolActive(true);
		// Dvorak Ctrl+/ reports codepoint '/' (47) and base layout '[' (91)
		const dvorakCtrlSlash = "\x1b[47::91;5u";
		expect(matchesKey(dvorakCtrlSlash, "ctrl+/")).toBe(true);
		expect(matchesKey(dvorakCtrlSlash, "ctrl+[")).toBe(false);
		setKittyProtocolActive(false);
	});
	it("ignores Kitty release events while still matching repeats", () => {
		setKittyProtocolActive(true);
		expect(matchesKey("\x1b[127u", "backspace")).toBe(true);
		expect(matchesKey("\x1b[127;1:2u", "backspace")).toBe(true);
		expect(matchesKey("\x1b[127;1:3u", "backspace")).toBe(false);
		setKittyProtocolActive(false);
	});
});

describe("parseKey", () => {
	it("should prefer codepoint for Latin letters when base layout differs", () => {
		setKittyProtocolActive(true);
		const dvorakCtrlK = "\x1b[107::118;5u";
		expect(parseKey(dvorakCtrlK)).toBe("ctrl+k");
		setKittyProtocolActive(false);
	});

	it("ignores Kitty release events while still parsing repeats", () => {
		setKittyProtocolActive(true);
		expect(parseKey("\x1b[127u")).toBe("backspace");
		expect(parseKey("\x1b[127;1:2u")).toBe("backspace");
		expect(parseKey("\x1b[127;1:3u")).toBeUndefined();
		setKittyProtocolActive(false);
	});

	it("should prefer codepoint for symbol keys when base layout differs", () => {
		setKittyProtocolActive(true);
		const dvorakCtrlSlash = "\x1b[47::91;5u";
		expect(parseKey(dvorakCtrlSlash)).toBe("ctrl+/");
		setKittyProtocolActive(false);
	});
});
