export function getOmkUserAgent(version: string): string {
	const runtime = process.versions.bun ? `bun/${process.versions.bun}` : `node/${process.version}`;
	return `omk/${version} (${process.platform}; ${runtime}; ${process.arch})`;
}
