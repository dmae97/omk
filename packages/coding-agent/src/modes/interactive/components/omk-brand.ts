import { OmkBrandSurfaceComponent, type OmkBrandSurfaceOptions } from "./omk-brand-surface.ts";

/**
 * `/brand` is the low-information OMK control splash: centered card, line art,
 * flowing cyan/magenta/green gradient, and bottom status/prompt chrome. The always-on chat HUD
 * remains information-oriented elsewhere.
 */
export class OmkBrandComponent extends OmkBrandSurfaceComponent {
	constructor(options: OmkBrandSurfaceOptions = {}) {
		super(options);
	}
}
