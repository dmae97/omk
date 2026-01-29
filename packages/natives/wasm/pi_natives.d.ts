/* tslint:disable */
/* eslint-disable */

/**
 * A compiled regex matcher that can be reused across multiple searches.
 */
export class CompiledPattern {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Check if content has any matches (faster than full search).
     */
    has_match(content: string): boolean;
    /**
     * Check if bytes have any matches (faster than full search).
     */
    has_match_bytes(content: Uint8Array): boolean;
    /**
     * Compile a regex pattern for reuse.
     */
    constructor(options: any);
    /**
     * Search content using this compiled pattern.
     * Returns matches as a JS object.
     */
    search(content: string, max_count?: number | null, offset?: number | null): any;
    /**
     * Search bytes directly (avoids UTF-16 to UTF-8 conversion).
     * Use with `Bun.mmap()` for best performance.
     */
    search_bytes(content: Uint8Array, max_count?: number | null, offset?: number | null): any;
}

/**
 * Image container for WASM interop.
 */
export class PhotonImage {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Export image as PNG bytes.
     */
    get_bytes(): Uint8Array;
    /**
     * Export image as JPEG bytes with specified quality (0-100).
     */
    get_bytes_jpeg(quality: number): Uint8Array;
    /**
     * Get the height of the image.
     */
    get_height(): number;
    /**
     * Get the width of the image.
     */
    get_width(): number;
    /**
     * Create a new PhotonImage from encoded image bytes (PNG, JPEG, WebP, GIF).
     */
    static new_from_byteslice(bytes: Uint8Array): PhotonImage;
}

/**
 * Sampling filter for resize operations.
 */
export enum SamplingFilter {
    Nearest = 1,
    Triangle = 2,
    CatmullRom = 3,
    Gaussian = 4,
    Lanczos3 = 5,
}

/**
 * Quick check if content matches a pattern.
 */
export function has_match(content: string, pattern: string, ignore_case: boolean, multiline: boolean): boolean;

/**
 * Resize an image to the specified dimensions.
 */
export function resize(image: PhotonImage, width: number, height: number, filter: SamplingFilter): PhotonImage;

/**
 * Search content for a pattern (one-shot, compiles pattern each time).
 * For repeated searches with the same pattern, use [`CompiledPattern`].
 */
export function search(content: string, options: any): any;
