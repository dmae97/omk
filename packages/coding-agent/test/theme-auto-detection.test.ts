import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as themeModule from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import * as nativesModule from "@oh-my-pi/pi-natives";

const originalPlatform = process.platform;
const originalColorfgbg = Bun.env.COLORFGBG;
const originalZellij = Bun.env.ZELLIJ;

describe("theme auto-detection", () => {
	beforeEach(() => {
		Object.defineProperty(process, "platform", { value: "darwin", configurable: true, writable: true });
		delete Bun.env.COLORFGBG;
		delete Bun.env.ZELLIJ;
		themeModule.stopThemeWatcher();
		vi.restoreAllMocks();
	});

	afterEach(() => {
		themeModule.stopThemeWatcher();
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
			configurable: true,
			writable: true,
		});
		if (originalColorfgbg === undefined) delete Bun.env.COLORFGBG;
		else Bun.env.COLORFGBG = originalColorfgbg;
		if (originalZellij === undefined) delete Bun.env.ZELLIJ;
		else Bun.env.ZELLIJ = originalZellij;
		vi.restoreAllMocks();
	});

	it("prefers COLORFGBG before macOS fallback inside Zellij", async () => {
		Bun.env.ZELLIJ = "1";
		Bun.env.COLORFGBG = "15;0";
		const detectSpy = vi.spyOn(nativesModule, "detectMacOSAppearance").mockReturnValue("light");

		await themeModule.initTheme(false, undefined, undefined, "dark", "light");

		expect(themeModule.getCurrentThemeName()).toBe("dark");
		expect(detectSpy).not.toHaveBeenCalled();
	});

	it("keeps honoring terminal-reported appearance outside fallback mode", async () => {
		const detectSpy = vi.spyOn(nativesModule, "detectMacOSAppearance").mockReturnValue("light");
		const observerSpy = vi.spyOn(nativesModule, "startMacAppearanceObserver");

		themeModule.onTerminalAppearanceChange("dark");
		await themeModule.initTheme(true, undefined, undefined, "dark", "light");

		expect(themeModule.getCurrentThemeName()).toBe("dark");
		expect(detectSpy).not.toHaveBeenCalled();
		expect(observerSpy).not.toHaveBeenCalled();
	});

	it("updates auto theme from the native fallback observer in Zellij", async () => {
		Bun.env.ZELLIJ = "1";
		const stop = vi.fn();
		let onAppearanceChange: ((appearance: "dark" | "light") => void) | undefined;
		vi.spyOn(nativesModule, "detectMacOSAppearance").mockReturnValue("light");
		const observerSpy = vi.spyOn(nativesModule, "startMacAppearanceObserver").mockImplementation(callback => {
			onAppearanceChange = callback;
			return { stop };
		});

		await themeModule.initTheme(true, undefined, undefined, "dark", "light");

		expect(observerSpy).toHaveBeenCalledTimes(1);
		expect(themeModule.getCurrentThemeName()).toBe("light");
		expect(onAppearanceChange).toBeDefined();

		onAppearanceChange!("dark");
		await Bun.sleep(0);

		expect(themeModule.getCurrentThemeName()).toBe("dark");
		themeModule.stopThemeWatcher();
		expect(stop).toHaveBeenCalledTimes(1);
	});
	it("Zellij fallback stays macOS-only (Linux + Zellij = honor terminal)", async () => {
		Object.defineProperty(process, "platform", { value: "linux", configurable: true, writable: true });
		Bun.env.ZELLIJ = "1";
		const detectSpy = vi.spyOn(nativesModule, "detectMacOSAppearance").mockReturnValue("light");

		themeModule.onTerminalAppearanceChange("dark");
		await themeModule.initTheme(false, undefined, undefined, "dark", "light");

		expect(themeModule.getCurrentThemeName()).toBe("dark");
		expect(detectSpy).not.toHaveBeenCalled();
	});

	it("terminal-reported appearance wins over conflicting COLORFGBG", async () => {
		Bun.env.COLORFGBG = "15;0";
		const detectSpy = vi.spyOn(nativesModule, "detectMacOSAppearance").mockReturnValue("light");

		themeModule.onTerminalAppearanceChange("light");
		await themeModule.initTheme(false, undefined, undefined, "dark", "light");

		expect(themeModule.getCurrentThemeName()).toBe("light");
		expect(detectSpy).not.toHaveBeenCalled();
	});
});
