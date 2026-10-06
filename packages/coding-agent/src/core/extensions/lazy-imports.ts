/**
 * Deferred imports for the extension loader.
 *
 * `jiti/static` eagerly requires jiti's bundled Babel (about 1.5 MB of CommonJS).
 * A static import in loader.ts made every process that reaches AgentSession pay
 * about 15 MB RSS and 8 MB heap at startup, even when it never loads an extension
 * file (the common `omk -p` worker case). It is imported on the first extension
 * load instead. Specifiers stay string literals so Bun still bundles them into
 * compiled binaries.
 */

type JitiStatic = typeof import("jiti/static");
type CreateJiti = JitiStatic["createJiti"];

let jitiStatic: Promise<JitiStatic> | undefined;

/** Same as `createJiti` from `jiti/static`, but imports jiti on first use. */
export async function createJitiLazily(...args: Parameters<CreateJiti>): Promise<ReturnType<CreateJiti>> {
	jitiStatic ??= import("jiti/static").catch((error: unknown) => {
		jitiStatic = undefined;
		throw error;
	});
	const { createJiti } = await jitiStatic;
	return createJiti(...args);
}
