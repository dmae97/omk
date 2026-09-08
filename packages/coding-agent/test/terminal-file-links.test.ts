import { resetCapabilitiesCache, setCapabilities } from "omk-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { linkPath } from "../src/core/tools/render-utils.ts";

afterEach(() => {
	vi.unstubAllEnvs();
	resetCapabilitiesCache();
});

describe("Windows-openable tool paths in WSL", () => {
	it("resolves relative artifacts against the tool/session cwd into a WSL UNC file URL", () => {
		// Given a Windows Terminal session and a project outside the harness checkout.
		vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu-24.04");
		vi.stubEnv("SSH_CONNECTION", "");
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
		// When rendering a report artifact link.
		const result = linkPath(
			"모바일 수정 화면",
			"docs/reviews/customer-value-browser/mobile-after.png",
			"/projects/app",
		);
		// Then Windows receives a UNC URL, not a relative or Linux-local address.
		expect(result).toContain(
			"\x1b]8;;file://wsl.localhost/Ubuntu-24.04/projects/app/docs/reviews/customer-value-browser/mobile-after.png\x1b\\",
		);
	});

	it("maps mounted Windows drive paths and URL-encodes filenames", () => {
		// Given a WSL user working on a Windows drive.
		vi.stubEnv("WSL_DISTRO_NAME", "Ubuntu-24.04");
		vi.stubEnv("SSH_CONNECTION", "");
		setCapabilities({ images: null, trueColor: true, hyperlinks: true });
		// When the file contains spaces and a literal hash character.
		const result = linkPath("report", "보고서 #1.html", "/mnt/c/Users/example/Desktop");
		// Then it links to the Windows drive and preserves the filename.
		expect(result).toContain("file:///C:/Users/example/Desktop/%EB%B3%B4%EA%B3%A0%EC%84%9C%20%231.html");
	});
});
