import * as path from "node:path";

export interface TypeFilter {
	extensions?: string[];
	names?: string[];
}

const TYPE_ALIASES: Record<string, TypeFilter> = {
	js: { extensions: ["js", "jsx", "mjs", "cjs"] },
	javascript: { extensions: ["js", "jsx", "mjs", "cjs"] },
	ts: { extensions: ["ts", "tsx", "mts", "cts"] },
	typescript: { extensions: ["ts", "tsx", "mts", "cts"] },
	json: { extensions: ["json", "jsonc", "json5"] },
	yaml: { extensions: ["yaml", "yml"] },
	yml: { extensions: ["yaml", "yml"] },
	toml: { extensions: ["toml"] },
	md: { extensions: ["md", "markdown", "mdx"] },
	markdown: { extensions: ["md", "markdown", "mdx"] },
	py: { extensions: ["py", "pyi"] },
	python: { extensions: ["py", "pyi"] },
	rs: { extensions: ["rs"] },
	rust: { extensions: ["rs"] },
	go: { extensions: ["go"] },
	java: { extensions: ["java"] },
	kt: { extensions: ["kt", "kts"] },
	kotlin: { extensions: ["kt", "kts"] },
	c: { extensions: ["c", "h"] },
	cpp: { extensions: ["cpp", "cc", "cxx", "hpp", "hxx", "hh"] },
	cxx: { extensions: ["cpp", "cc", "cxx", "hpp", "hxx", "hh"] },
	cs: { extensions: ["cs", "csx"] },
	csharp: { extensions: ["cs", "csx"] },
	php: { extensions: ["php", "phtml"] },
	rb: { extensions: ["rb", "rake", "gemspec"] },
	ruby: { extensions: ["rb", "rake", "gemspec"] },
	sh: { extensions: ["sh", "bash", "zsh", "fish"] },
	bash: { extensions: ["sh", "bash", "zsh"] },
	zsh: { extensions: ["zsh"] },
	fish: { extensions: ["fish"] },
	html: { extensions: ["html", "htm"] },
	css: { extensions: ["css"] },
	scss: { extensions: ["scss"] },
	sass: { extensions: ["sass"] },
	less: { extensions: ["less"] },
	xml: { extensions: ["xml"] },
	docker: { names: ["dockerfile"] },
	dockerfile: { names: ["dockerfile"] },
	make: { names: ["makefile"] },
	makefile: { names: ["makefile"] },
};

export function buildGlobPattern(glob?: string): string {
	const trimmed = glob?.trim();
	if (!trimmed) return "**/*";
	const normalized = trimmed.replace(/\\/g, "/");
	if (normalized.includes("/") || normalized.startsWith("**/")) return normalized;
	return `**/${normalized}`;
}

export function resolveTypeFilter(type?: string): TypeFilter | undefined {
	if (!type) return undefined;
	const trimmed = type.trim();
	if (!trimmed) return undefined;
	const normalized = trimmed.toLowerCase();
	const withoutDot = normalized.startsWith(".") ? normalized.slice(1) : normalized;
	return TYPE_ALIASES[withoutDot] ?? { extensions: [withoutDot] };
}

export function matchesTypeFilter(filePath: string, filter?: TypeFilter): boolean {
	if (!filter) return true;
	const baseName = path.basename(filePath).toLowerCase();
	if (filter.names?.some(name => name.toLowerCase() === baseName)) {
		return true;
	}
	const ext = path.extname(baseName).slice(1).toLowerCase();
	if (!ext) return false;
	return filter.extensions?.includes(ext) ?? false;
}
