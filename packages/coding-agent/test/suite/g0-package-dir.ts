import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface G0PackageDir {
	linkDir: string;
	packageDir: string;
	cleanup: () => void;
}

/**
 * Creates <mkdtemp(os.tmpdir()/omk-g0-XXXXXX)>/pkg as a symlink to `linkTarget` and asserts it resolves to
 * `expectedRoot`. On mismatch the temp dir is removed and an error is thrown, so G0 never measures another build.
 */
export function createG0PackageDir(expectedRoot: string, linkTarget: string = expectedRoot): G0PackageDir {
	const linkDir = mkdtempSync(join(tmpdir(), "omk-g0-"));
	const cleanup = () => rmSync(linkDir, { recursive: true, force: true });
	const packageDir = join(linkDir, "pkg");
	try {
		symlinkSync(linkTarget, packageDir, "dir");
		if (realpathSync(packageDir) !== realpathSync(expectedRoot)) {
			throw new Error(`${packageDir} does not resolve to this checkout (${expectedRoot})`);
		}
	} catch (error) {
		cleanup();
		throw error;
	}
	return { linkDir, packageDir, cleanup };
}
