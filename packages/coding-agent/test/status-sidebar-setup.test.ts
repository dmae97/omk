import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TUI } from "omk-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { FooterDataProvider } from "../src/core/footer-data-provider.ts";
import { STATUS_SIDEBAR_GUTTER_GAP, statusSidebarWidth } from "../src/modes/interactive/components/status-sidebar.ts";
import { setupStatusSidebar } from "../src/modes/interactive/status-sidebar-setup.ts";

const cleanup: Array<() => void> = [];
afterEach(() => {
	for (const release of cleanup.splice(0).reverse()) release();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "omk-sidebar-setup-"));
	const footerData = new FooterDataProvider(root);
	const ui = new TUI(new VirtualTerminal(200, 50));
	vi.spyOn(ui, "requestRender").mockImplementation(() => {});
	cleanup.push(
		() => rmSync(root, { recursive: true, force: true }),
		() => footerData.dispose(),
	);
	return {
		footerData,
		ui,
		getSession: () => {
			throw new Error("Session must be read lazily");
		},
	};
}

describe("status sidebar mounting", () => {
	it("mounts the optional hybrid without taking input or changing the gutter policy", () => {
		vi.stubEnv("OMK_OPENTUI_STATUS_RAIL", "1");
		const options = fixture();
		const showOverlay = vi.spyOn(options.ui, "showOverlay");
		const visible = () => true;
		const status = setupStatusSidebar({ ...options, visible });
		cleanup.push(() => status.statusPanel?.dispose());
		expect(status.statusPanel).toBeDefined();
		expect(showOverlay).toHaveBeenCalledWith(
			status.statusPanel,
			expect.objectContaining({ nonCapturing: true, visible }),
		);
		expect(options.ui.contentWidth).toBe(200 - statusSidebarWidth(200) - STATUS_SIDEBAR_GUTTER_GAP);
	});

	it("mounts the OpenTUI rail by default and keeps the native sidebar as its fallback", () => {
		const options = fixture();
		const showOverlay = vi.spyOn(options.ui, "showOverlay");
		const status = setupStatusSidebar({ ...options, visible: () => true });
		cleanup.push(() => status.statusPanel?.dispose());
		expect(status.statusPanel).toBeDefined();
		expect(showOverlay).toHaveBeenCalledWith(status.statusPanel, expect.objectContaining({ nonCapturing: true }));
	});

	it("keeps the native sidebar when OMK_OPENTUI_STATUS_RAIL=0", () => {
		vi.stubEnv("OMK_OPENTUI_STATUS_RAIL", "0");
		const options = fixture();
		const showOverlay = vi.spyOn(options.ui, "showOverlay");
		const status = setupStatusSidebar({ ...options, visible: () => true });
		expect(status.statusPanel).toBeUndefined();
		expect(showOverlay).toHaveBeenCalledWith(status.sidebar, expect.objectContaining({ nonCapturing: true }));
	});

	it("keeps overlay visibility and the reserved gutter on the same live policy", () => {
		vi.stubEnv("OMK_OPENTUI_STATUS_RAIL", "0");
		const options = fixture();
		const showOverlay = vi.spyOn(options.ui, "showOverlay");
		let pinned = true;
		const visible = (width: number, height: number) => pinned && width >= 96 && height >= 20;
		const status = setupStatusSidebar({ ...options, visible });
		expect(showOverlay).toHaveBeenCalledWith(
			status.sidebar,
			expect.objectContaining({
				visible,
				width: statusSidebarWidth,
				nonCapturing: true,
			}),
		);
		expect(options.ui.contentWidth).toBe(200 - statusSidebarWidth(200) - STATUS_SIDEBAR_GUTTER_GAP);
		pinned = false;
		expect(options.ui.contentWidth).toBe(200);
	});
});
