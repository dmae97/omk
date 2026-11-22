import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isBunBinary } from "../../config.ts";
/**
 * The parts of `@opentui/core` the status panel uses. The package is an optional dependency that needs Node 26.4+,
 * so it is loaded at runtime in the render worker and is never required to type-check or build OMK.
 */
export interface OpenTuiNode {
	add(child: OpenTuiNode): unknown;
	destroyRecursively(): void;
	flexShrink: number;
	maxWidth: unknown;
}

export interface OpenTuiRenderer {
	readonly root: OpenTuiNode;
}

type NodeConstructor = new (renderer: OpenTuiRenderer, options: Record<string, unknown>) => OpenTuiNode;

interface OpenTuiColor {
	toInts(): readonly [number, number, number, number];
}

export interface OpenTuiCapturedLine {
	readonly spans: readonly {
		readonly text: string;
		readonly attributes: number;
		readonly fg: OpenTuiColor;
		readonly bg: OpenTuiColor;
	}[];
}

export interface OpenTuiTestSetup {
	readonly renderer: OpenTuiRenderer;
	resize(width: number, height: number): void;
	renderOnce(): Promise<void>;
	captureSpans(): { readonly lines: OpenTuiCapturedLine[] };
	dispose(): unknown;
}

export interface OpenTui {
	readonly BoxRenderable: NodeConstructor;
	readonly TextRenderable: NodeConstructor;
	readonly boldAttribute: number;
	createTestRenderer(options: Record<string, unknown>): Promise<OpenTuiTestSetup>;
}

export async function loadOpenTui(): Promise<OpenTui> {
	// The standalone worker must load the native library from disk beside the executable.
	const packaged = (entry: string) =>
		pathToFileURL(join(dirname(process.execPath), "node_modules", "@opentui", "core", entry)).href;
	const coreName = isBunBinary ? packaged("index.bun.js") : "@opentui/core";
	const testingName = isBunBinary ? packaged("testing.bun.js") : "@opentui/core/testing";
	const [core, testing] = await Promise.all([import(coreName), import(testingName)]);
	return {
		BoxRenderable: core.BoxRenderable,
		TextRenderable: core.TextRenderable,
		boldAttribute: core.TextAttributes.BOLD,
		createTestRenderer: testing.createTestRenderer,
	};
}
