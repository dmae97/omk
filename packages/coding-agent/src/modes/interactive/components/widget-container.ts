import { type Component, type Container, Spacer } from "omk-tui";

export function renderWidgetContainer(
	container: Container,
	widgets: Map<string, Component & { dispose?(): void }>,
	spacerWhenEmpty: boolean,
	leadingSpacer: boolean,
): void {
	container.clear();
	if (widgets.size === 0) {
		if (spacerWhenEmpty) container.addChild(new Spacer(1));
		return;
	}
	if (leadingSpacer) container.addChild(new Spacer(1));
	for (const component of widgets.values()) {
		container.addChild(component);
	}
}

export interface WidgetPairHost {
	readonly widgetContainerAbove?: Container;
	readonly widgetContainerBelow?: Container;
	readonly extensionWidgetsAbove: Map<string, Component & { dispose?(): void }>;
	readonly extensionWidgetsBelow: Map<string, Component & { dispose?(): void }>;
	readonly ui: { requestRender(): void };
}

export function renderWidgetPair(host: WidgetPairHost): void {
	if (!host.widgetContainerAbove || !host.widgetContainerBelow) return;
	renderWidgetContainer(host.widgetContainerAbove, host.extensionWidgetsAbove, true, true);
	renderWidgetContainer(host.widgetContainerBelow, host.extensionWidgetsBelow, false, false);
	host.ui.requestRender();
}
