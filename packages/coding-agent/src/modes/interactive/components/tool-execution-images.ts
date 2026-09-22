import { createHash } from "node:crypto";
import { Container, getCapabilities, Image, Spacer, Text } from "omk-tui";
import { convertToPng } from "../../../utils/image-convert.ts";
import { theme } from "../theme/theme.ts";

type ImageSource = { data?: string; mimeType?: string };
type ConvertedImage = NonNullable<Awaited<ReturnType<typeof convertToPng>>>;
interface Flight {
	generation: number;
	promise: Promise<void>;
}

/** Owns display-only conversions; original tool results remain authoritative. */
export class ToolExecutionImages extends Container {
	private sources: ImageSource[] = [];
	private keys: (string | undefined)[] = [];
	private wanted = new Set<string>();
	private readonly converted = new Map<string, ConvertedImage>();
	private readonly active = new Map<string, Flight>();
	private readonly failed = new Set<string>();
	private generation = 0;
	private disposed = false;
	private show: boolean;
	private width: number;
	private onChange?: () => void;

	constructor(onChange: () => void, show = true, width = 60) {
		super();
		this.onChange = onChange;
		this.show = show;
		this.width = width;
	}

	get pendingCount(): number {
		return this.active.size;
	}

	async whenSettled(): Promise<void> {
		await Promise.all([...this.active.values()].map((flight) => flight.promise));
	}

	setResult(content: readonly (ImageSource & { type: string })[]): void {
		if (this.disposed) return;
		const images = content.filter((block) => block.type === "image");
		const keys = images.map((image, index) => {
			if (!image.data || !image.mimeType) return undefined;
			const previous = this.sources[index];
			if (previous?.data === image.data && previous.mimeType === image.mimeType) return this.keys[index];
			return createHash("sha256").update(image.mimeType).update("\0").update(image.data).digest("hex");
		});
		this.sources = images.map(({ data, mimeType }) => ({ data, mimeType }));
		this.keys = keys;
		this.wanted = new Set(keys.filter((key): key is string => key !== undefined));
		this.generation++;
		this.failed.clear(); // Retry only after an explicit result update, never on paint.
		for (const key of this.converted.keys()) {
			if (!this.wanted.has(key)) this.converted.delete(key);
		}
		for (const [key, flight] of this.active) {
			if (this.wanted.has(key)) flight.generation = this.generation;
		}
		this.startConversions();
		this.rebuild();
	}

	setDisplay(show: boolean, width: number): void {
		if (this.disposed) return;
		this.show = show;
		this.width = width;
		this.startConversions();
		this.rebuild();
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.generation++;
		this.onChange = undefined;
		this.sources = [];
		this.keys = [];
		this.wanted.clear();
		this.converted.clear();
		this.failed.clear();
		this.clear();
		// The converter has no cancellation API. Retain active ownership until settlement.
	}

	private startConversions(): void {
		if (this.disposed || !this.show || getCapabilities().images !== "kitty") return;
		for (let i = 0; i < this.sources.length; i++) {
			const source = this.sources[i];
			const key = this.keys[i];
			if (!key || !source.data || !source.mimeType || source.mimeType === "image/png") continue;
			if (this.active.has(key) || this.converted.has(key) || this.failed.has(key)) continue;
			const flight: Flight = { generation: this.generation, promise: Promise.resolve() };
			this.active.set(key, flight);
			flight.promise = this.convert(key, source.data, source.mimeType, flight);
		}
	}

	private async convert(key: string, data: string, mimeType: string, flight: Flight): Promise<void> {
		try {
			let converted: ConvertedImage | null;
			try {
				converted = await convertToPng(data, mimeType);
			} catch {
				converted = null; // Visible failure below; keep the original source for retry.
			}
			if (this.disposed || flight.generation !== this.generation || !this.wanted.has(key)) return;
			if (converted) this.converted.set(key, converted);
			else this.failed.add(key);
			this.rebuild();
			if (this.show) this.onChange?.();
		} finally {
			if (this.active.get(key) === flight) this.active.delete(key);
		}
	}

	private rebuild(): void {
		this.clear();
		const caps = getCapabilities();
		if (this.disposed || !this.show || !caps.images) return;
		for (let i = 0; i < this.sources.length; i++) {
			const source = this.sources[i];
			const key = this.keys[i];
			if (!key || !source.data || !source.mimeType) continue;
			const image = this.converted.get(key) ?? { data: source.data, mimeType: source.mimeType };
			if (caps.images === "kitty" && image.mimeType !== "image/png") {
				if (this.failed.has(key)) {
					this.addChild(new Spacer(1));
					this.addChild(new Text(theme.fg("warning", "Image conversion unavailable; original retained"), 1, 0));
				}
				continue;
			}
			this.addChild(new Spacer(1));
			this.addChild(
				new Image(
					image.data,
					image.mimeType,
					{
						fallbackColor: (text: string) => theme.fg("toolOutput", text),
					},
					{ maxWidthCells: this.width },
				),
			);
		}
	}
}
