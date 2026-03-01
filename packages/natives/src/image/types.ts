/**
 * Types for image processing.
 */

/** Output format for image encoding. */
export const enum ImageFormat {
	/** PNG encoded bytes. */
	PNG = 0,
	/** JPEG encoded bytes. */
	JPEG = 1,
	/** WebP encoded bytes. */
	WEBP = 2,
	/** GIF encoded bytes. */
	GIF = 3,
}

/** Sampling filter for resize operations. */
export const enum SamplingFilter {
	/** Nearest-neighbor sampling (fast, low quality). */
	Nearest = 1,
	/** Triangle filter (linear interpolation). */
	Triangle = 2,
	/** Catmull-Rom filter with sharper edges. */
	CatmullRom = 3,
	/** Gaussian filter for smoother results. */
	Gaussian = 4,
	/** Lanczos3 filter for high-quality downscaling. */
	Lanczos3 = 5,
}

/** Image container for native image operations. */
export interface PhotonImage {
	/** Image width in pixels. */
	get width(): number;
	/** Image height in pixels. */
	get height(): number;
	/**
	 * Encode the image using the requested format and quality.
	 * Returns the encoded image bytes.
	 */
	encode(format: ImageFormat, quality: number): Promise<Uint8Array>;
	/**
	 * Resize the image to the requested dimensions with the filter.
	 * Returns a new image instance.
	 */
	resize(width: number, height: number, filter: SamplingFilter): Promise<PhotonImage>;
}

/** Static entrypoints for creating `PhotonImage` instances. */
export interface PhotonImageConstructor {
	/** Parse image bytes (PNG, JPEG, WebP, GIF) into a native image. */
	parse(bytes: Uint8Array): Promise<PhotonImage>;
	/** Instance prototype reference. */
	prototype: PhotonImage;
}

declare module "../bindings" {
	/** Native bindings for image operations. */
	interface NativeBindings {
		/** Sampling filters exposed by the native module. */
		SamplingFilter: typeof SamplingFilter;
		/** Photon image constructor exposed by the native module. */
		PhotonImage: PhotonImageConstructor;
		/** Encode image bytes to SIXEL escape sequence at target pixel size. */
		encodeSixel(bytes: Uint8Array, targetWidthPx: number, targetHeightPx: number): string;
	}
}
