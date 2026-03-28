/**
 * Interactive marketplace plugin selector.
 *
 * Shows available plugins from all configured marketplaces in a SelectList.
 * Selecting a plugin triggers installation. Esc cancels.
 */
import { Container, type SelectItem, SelectList } from "@oh-my-pi/pi-tui";
import { getSelectListTheme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";

export interface PluginSelectorCallbacks {
	onSelect: (pluginName: string, marketplace: string) => void;
	onCancel: () => void;
}

export interface PluginItem {
	plugin: { name: string; version?: string; description?: string };
	marketplace: string;
}

export class PluginSelectorComponent extends Container {
	#selectList: SelectList;

	constructor(
		marketplaceCount: number,
		plugins: PluginItem[],
		installedIds: Set<string>,
		callbacks: PluginSelectorCallbacks,
	) {
		super();

		const items: SelectItem[] = plugins.map(({ plugin, marketplace }) => {
			const id = `${plugin.name}@${marketplace}`;
			const installed = installedIds.has(id);
			const version = plugin.version ? `@${plugin.version}` : "";
			const status = installed ? " [installed]" : "";

			return {
				value: id,
				label: `${plugin.name}${version}${status}`,
				description: plugin.description,
				hint: marketplace,
			};
		});

		if (items.length === 0) {
			items.push({
				value: "__empty__",
				label: "No plugins available",
				description:
					marketplaceCount === 0
						? "Add a marketplace first: /marketplace add <source>"
						: "Configured marketplaces have no plugins",
			});
		}

		this.addChild(new DynamicBorder());

		this.#selectList = new SelectList(items, Math.min(items.length, 20), getSelectListTheme());

		this.#selectList.onSelect = item => {
			if (item.value === "__empty__") return;
			const [name, marketplace] = splitPluginId(item.value);
			if (name && marketplace) {
				callbacks.onSelect(name, marketplace);
			}
		};

		this.#selectList.onCancel = () => {
			callbacks.onCancel();
		};

		this.addChild(this.#selectList);
		this.addChild(new DynamicBorder());
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}
}

function splitPluginId(id: string): [string, string] | [null, null] {
	const atIdx = id.lastIndexOf("@");
	if (atIdx <= 0) return [null, null];
	return [id.slice(0, atIdx), id.slice(atIdx + 1)];
}
