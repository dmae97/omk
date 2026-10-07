/**
 * Deferred imports for the extension loader.
 *
 * `jiti/static` eagerly requires jiti's bundled Babel (about 1.5 MB of CommonJS).
 * A static import in loader.ts made every process that reaches AgentSession pay
 * about 15 MB RSS and 8 MB heap at startup, even when it never loads an extension
 * file (the common `omk -p` worker case). It is imported on the first extension
 * load instead. Specifiers stay string literals so Bun still bundles them into
 * compiled binaries.
 *
 * `bundled-virtual-modules` statically imports `omk-tui` (and other package
 * namespaces) so Bun can virtualize them for compiled-binary extensions. Node
 * `-p` / workers never call `buildVirtualModules()`, so keep that module off the
 * cold path until a Bun-binary extension load actually needs it.
 */

type JitiStatic = typeof import("jiti/static");
type CreateJiti = JitiStatic["createJiti"];
type BundledVirtualModules = typeof import("./bundled-virtual-modules.ts");

let jitiStatic: Promise<JitiStatic> | undefined;
let bundledVirtualModules: Promise<BundledVirtualModules> | undefined;

/** Same as `createJiti` from `jiti/static`, but imports jiti on first use. */
export async function createJitiLazily(...args: Parameters<CreateJiti>): Promise<ReturnType<CreateJiti>> {
	jitiStatic ??= import("jiti/static").catch((error: unknown) => {
		jitiStatic = undefined;
		throw error;
	});
	const { createJiti } = await jitiStatic;
	return createJiti(...args);
}

/** `buildVirtualModules()` without a static `omk-tui` edge on the Node cold path. */
export async function buildVirtualModulesLazily(): Promise<ReturnType<BundledVirtualModules["buildVirtualModules"]>> {
	bundledVirtualModules ??= import("./bundled-virtual-modules.ts").catch((error: unknown) => {
		bundledVirtualModules = undefined;
		throw error;
	});
	const { buildVirtualModules } = await bundledVirtualModules;
	return buildVirtualModules();
}
