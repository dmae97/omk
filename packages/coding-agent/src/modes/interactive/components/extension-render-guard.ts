import { type Component, Text } from "omk-tui";

const guarded = new WeakMap<Component, { fallback?: () => Component | undefined }>();

/** Keep the original object for focus, disposal and lastComponent identity; quarantine failed instances. */
export function guardExtensionRender<T extends Component>(component: T, fallback?: () => Component | undefined): T {
	const existing = guarded.get(component);
	if (existing) {
		existing.fallback = fallback;
		return component;
	}
	const state = { fallback };
	const render = component.render;
	const invalidate = component.invalidate;
	const notice = new Text("Extension render failed", 0, 0);
	let failed = false;
	component.render = (width) => {
		if (!failed) {
			try {
				return render.call(component, width);
			} catch {
				failed = true;
			}
		}
		return [...notice.render(width), ...(state.fallback?.()?.render(width) ?? [])];
	};
	component.invalidate = () => {
		if (failed) return;
		try {
			invalidate.call(component);
		} catch {
			failed = true;
		}
	};
	guarded.set(component, state);
	return component;
}
