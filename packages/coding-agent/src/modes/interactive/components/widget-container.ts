import { type Component, type Container, Spacer } from "omk-tui";
import { createTodosHiddenBanner, isTodoWidgetKey } from "../todos-visibility.ts";

export function renderWidgetContainer(
	container: Container,
	widgets: Map<string, Component & { dispose?(): void }>,
	spacerWhenEmpty: boolean,
	leadingSpacer: boolean,
	todosVisible = true,
): void {
	container.clear();
	if (widgets.size === 0) {
		if (spacerWhenEmpty) container.addChild(new Spacer(1));
		return;
	}
	if (leadingSpacer) container.addChild(new Spacer(1));
	let renderedHiddenBanner = false;
	for (const [key, component] of widgets.entries()) {
		if (!todosVisible && isTodoWidgetKey(key)) {
			if (!renderedHiddenBanner) {
				container.addChild(createTodosHiddenBanner());
				renderedHiddenBanner = true;
			}
			continue;
		}
		container.addChild(component);
	}
}

export interface WidgetPairHost {
	readonly widgetContainerAbove?: Container;
	readonly widgetContainerBelow?: Container;
	readonly extensionWidgetsAbove: Map<string, Component & { dispose?(): void }>;
	readonly extensionWidgetsBelow: Map<string, Component & { dispose?(): void }>;
	readonly ui: { requestRender(): void };
	readonly filesSidebar?: { isTodosVisible(): boolean };
	readonly builtInHeader?: { invalidate(): void };
	readonly footer?: { invalidate(): void };
	readonly hybridFooter?: { invalidate?(): void };
}

export function renderWidgetPair(host: WidgetPairHost): void {
	if (!host.widgetContainerAbove || !host.widgetContainerBelow) return;
	const todosVisible = host.filesSidebar?.isTodosVisible() ?? true;
	renderWidgetContainer(host.widgetContainerAbove, host.extensionWidgetsAbove, true, true, todosVisible);
	renderWidgetContainer(host.widgetContainerBelow, host.extensionWidgetsBelow, false, false, todosVisible);
	host.builtInHeader?.invalidate();
	host.footer?.invalidate();
	host.hybridFooter?.invalidate?.();
	host.ui.requestRender();
}
