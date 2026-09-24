/** UTF-16 code-unit order is independent of the host locale and ICU collation tables. */
export function compareContextIds(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
