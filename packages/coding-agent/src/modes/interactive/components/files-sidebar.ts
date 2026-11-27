import { type Component, type Focusable, Key, matchesKey } from "omk-tui";
import { computePreviewDrawerLayout, type FilesSidebarModel } from "./files-sidebar-model.ts";
import { renderCollapsedFilesRail, renderOpenFilesSidebar } from "./files-sidebar-render.ts";

export interface FilesSidebarCallbacks {
	readonly getRows: () => number;
	readonly requestRender: () => void;
	readonly onInsertPath: (relPath: string) => void;
	readonly onReturnFocus: () => void;
	readonly onToggleMode: () => void;
}

export class FilesSidebarComponent implements Component, Focusable {
	focused = false;
	private readonly model: FilesSidebarModel;
	private readonly cb: FilesSidebarCallbacks;
	private lastTreeViewportRows = 16;

	constructor(model: FilesSidebarModel, callbacks: FilesSidebarCallbacks) {
		this.model = model;
		this.cb = callbacks;
	}

	getTreeViewportRows = (): number => this.lastTreeViewportRows;

	invalidate(): void {}

	handleInput(data: string): void {
		if (matchesKey(data, Key.ctrl("b")) || matchesKey(data, Key.alt("b"))) {
			this.cb.onToggleMode();
			return;
		}
		if (matchesKey(data, Key.alt("e"))) {
			this.cb.onReturnFocus();
			return;
		}
		if (this.model.isFiltering()) {
			this.handleFilterInput(data);
			return;
		}
		if (this.model.getPreview()) {
			this.handlePreviewInput(data);
			return;
		}
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.tab)) {
			this.cb.onReturnFocus();
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			this.model.moveSelection(-1, this.lastTreeViewportRows);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			this.model.moveSelection(1, this.lastTreeViewportRows);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.pageUp)) {
			this.model.moveSelection(-Math.max(5, this.lastTreeViewportRows - 2), this.lastTreeViewportRows);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.pageDown)) {
			this.model.moveSelection(Math.max(5, this.lastTreeViewportRows - 2), this.lastTreeViewportRows);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter) || matchesKey(data, Key.right) || data === "l") {
			this.model.activateSelected();
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.left) || data === "h") {
			this.model.collapseSelectedOrParent();
			this.cb.requestRender();
			return;
		}
		if (data === "@" || data === " ") {
			const entry = this.model.getSelectedEntry();
			if (entry) this.cb.onInsertPath(entry.path);
			return;
		}
		if (data === "/") {
			this.model.setFiltering(true);
			this.cb.requestRender();
			return;
		}
		if (data === ".") {
			this.model.toggleHidden();
			this.cb.requestRender();
			return;
		}
		if (data === "c") {
			this.model.collapseAll();
			this.cb.requestRender();
			return;
		}
		if (data === "r") {
			this.model.refresh();
			this.cb.requestRender();
			return;
		}
		if (data === "[") {
			this.model.adjustWidth(-4);
			this.cb.requestRender();
			return;
		}
		if (data === "]") {
			this.model.adjustWidth(4);
			this.cb.requestRender();
		}
		if (data === "+") {
			if (this.model.expandExplorationLimit()) this.cb.requestRender();
		}
	}

	private handlePreviewInput(data: string): void {
		const { bodyRows } = computePreviewDrawerLayout(this.cb.getRows());
		const pageStep = Math.max(1, bodyRows - 1);
		if (matchesKey(data, Key.escape)) {
			this.model.closePreview();
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			this.model.scrollPreview(-1, bodyRows);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			this.model.scrollPreview(1, bodyRows);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.pageUp)) {
			this.model.scrollPreview(-pageStep, bodyRows);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.pageDown)) {
			this.model.scrollPreview(pageStep, bodyRows);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter) || data === "@" || data === " ") {
			const path = this.model.getPreview()?.path;
			if (path) this.cb.onInsertPath(path);
		}
	}

	private handleFilterInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			if (this.model.getFilter()) this.model.setFilter("");
			this.model.setFiltering(false);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.up)) {
			this.model.moveSelection(-1, this.lastTreeViewportRows);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.model.moveSelection(1, this.lastTreeViewportRows);
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.tab)) {
			const entry = this.model.getSelectedEntry();
			this.model.setFiltering(false);
			if (entry) this.cb.onInsertPath(entry.path);
			else this.cb.onReturnFocus();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.model.setFiltering(false);
			this.model.activateSelected();
			this.cb.requestRender();
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			this.model.setFilter(this.model.getFilter().slice(0, -1));
			this.cb.requestRender();
			return;
		}
		if (data.length === 1 && data.charCodeAt(0) >= 0x20 && data.charCodeAt(0) !== 0x7f) {
			this.model.setFilter(this.model.getFilter() + data);
			this.cb.requestRender();
		}
	}

	render(width: number): string[] {
		const height = Math.max(8, this.cb.getRows());
		const mode = this.model.getMode();
		if (mode === "hidden" || width < 2) return [];
		if (mode === "collapsed" || width <= 4) return renderCollapsedFilesRail(width, height, this.focused);
		return renderOpenFilesSidebar(this.model, this.focused, width, height, (rows) => {
			this.lastTreeViewportRows = rows;
		});
	}
}
