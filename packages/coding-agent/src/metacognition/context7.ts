/**
 * Fixed-origin Context7 GET adapter with explicit egress approval.
 *
 * Ported from docs/OMK_skill_knowledge_control_2026-09-19.zip
 * (src/context7.ts). Every attempted HTTP request consumes a shared
 * AcquisitionPool permit; there is no retry, redirect-following, or
 * auto-selection of the first result. Returned `rules` fields are data, never
 * promoted to instructions.
 */
import type { AcquisitionPool, AcquisitionResult } from "./retrieval.ts";
import { ensure, integer, text } from "./validation.ts";

export interface Context7Options {
	readonly apiKey: string;
	readonly enabled: boolean;
	readonly approvedLibraryNames: readonly string[];
	readonly approvedLibraryIds: readonly string[];
	readonly approvedQueries: readonly string[];
	readonly pool: AcquisitionPool;
	readonly maxResponseBytes?: number;
	readonly fetchImpl?: typeof fetch;
}
export interface LibraryCandidate {
	readonly id: string;
	readonly title: string;
	readonly versions: readonly string[];
}
export interface DocumentationCandidate {
	readonly uri: string;
	readonly body: string;
	readonly requestedLibraryId: string;
	readonly trust: "candidate-only";
}
/** Fixed-origin GET adapter. In OMK prefer routing equivalent requests through admitted MCP tools. */
export class Context7Client {
	private readonly key: string;
	private readonly enabled: boolean;
	private readonly names: ReadonlySet<string>;
	private readonly ids: ReadonlySet<string>;
	private readonly queries: ReadonlySet<string>;
	private readonly pool: AcquisitionPool;
	private readonly fetcher: typeof fetch;
	private readonly limit: number;
	constructor(options: Context7Options) {
		text(options.apiKey, "apiKey", 4096);
		ensure(typeof options.enabled === "boolean", "enabled must be boolean");
		this.limit = options.maxResponseBytes ?? 200_000;
		integer(this.limit, "maxResponseBytes", 2_000_000);
		ensure(this.limit > 0, "response limit must be positive");
		this.key = options.apiKey;
		this.enabled = options.enabled;
		this.names = new Set(options.approvedLibraryNames);
		this.ids = new Set(options.approvedLibraryIds);
		this.queries = new Set(options.approvedQueries);
		this.pool = options.pool;
		this.fetcher = options.fetchImpl ?? fetch;
	}
	resolveLibraries(
		name: string,
		query: string,
		signal?: AbortSignal,
	): Promise<AcquisitionResult<readonly LibraryCandidate[]>> {
		this.authorize(query);
		text(name, "libraryName", 500);
		ensure(this.names.has(name), "unapproved library name");
		return this.pool.run(async (abort) => {
			const payload = await this.get("/api/v2/libs/search", { libraryName: name, query }, abort);
			const object = record(payload);
			ensure(Array.isArray(object.results), "invalid search response");
			ensure(object.results.length <= 256, "too many library candidates");
			return object.results.map((raw): LibraryCandidate => {
				const candidate = record(raw);
				const id = string(candidate.id),
					title = string(candidate.title);
				const versions = candidate.versions ?? [];
				ensure(Array.isArray(versions) && versions.every((v) => typeof v === "string"), "invalid versions");
				return { id, title, versions: versions as string[] };
			});
		}, signal);
	}
	getDocumentation(
		id: string,
		query: string,
		signal?: AbortSignal,
	): Promise<AcquisitionResult<readonly DocumentationCandidate[]>> {
		this.authorize(query);
		text(id, "libraryId", 500);
		ensure(this.ids.has(id), "unapproved library id: validate identity/version before retrieval");
		return this.pool.run(async (abort) => {
			const object = record(await this.get("/api/v2/context", { libraryId: id, query, type: "json" }, abort));
			const info = object.infoSnippets,
				code = object.codeSnippets;
			ensure(Array.isArray(info) && Array.isArray(code), "invalid documentation response");
			ensure(info.length + code.length <= 256, "too many snippets");
			const result: DocumentationCandidate[] = [];
			const add = (uri: unknown, body: string): void => {
				if (typeof uri !== "string") return;
				let parsed: URL;
				try {
					parsed = new URL(uri);
				} catch {
					return;
				}
				// Metadata only, never followed. Reject executable/non-web references.
				if (parsed.protocol !== "https:" || parsed.username || parsed.password) return;
				result.push({ uri: parsed.href, body, requestedLibraryId: id, trust: "candidate-only" });
			};
			for (const raw of info) {
				const v = record(raw);
				add(v.pageId, string(v.content));
			}
			for (const raw of code) {
				const v = record(raw);
				const list = v.codeList;
				ensure(Array.isArray(list), "invalid codeList");
				const body = list.map((item) => string(record(item).code)).join("\n\n");
				add(v.codeId, body);
			}
			// The response's optional `rules` field is deliberately not promoted to instructions.
			return result;
		}, signal);
	}
	private authorize(query: string): void {
		ensure(this.enabled, "remote acquisition disabled");
		text(query, "public query", 500);
		ensure(this.queries.has(query), "query has not been approved for egress");
	}
	private async get(path: string, parameters: Record<string, string>, signal: AbortSignal): Promise<unknown> {
		const url = new URL(path, "https://context7.com");
		for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
		const response = await this.fetcher(url, {
			method: "GET",
			redirect: "error",
			signal,
			headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json" },
		});
		// No retry here: every attempted HTTP request must acquire a fresh shared budget slot.
		if (response.status !== 200) {
			if (response.body) await response.body.cancel();
			throw new Error(`context7-http-${response.status}`);
		}
		const contentType = response.headers.get("content-type") ?? "";
		if (!contentType.includes("application/json")) {
			if (response.body) await response.body.cancel();
			throw new Error("unexpected response content type");
		}
		ensure(response.body !== null, "missing response body");
		const reader = response.body.getReader();
		let bytes = 0;
		const chunks: Uint8Array[] = [];
		try {
			while (true) {
				const next = await reader.read();
				if (next.done) break;
				bytes += next.value.byteLength;
				ensure(bytes <= this.limit, "response byte budget exceeded");
				chunks.push(next.value);
			}
		} catch (error) {
			await reader.cancel();
			throw error;
		} finally {
			reader.releaseLock();
		}
		const joined = new Uint8Array(bytes);
		let at = 0;
		for (const chunk of chunks) {
			joined.set(chunk, at);
			at += chunk.byteLength;
		}
		try {
			return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined)) as unknown;
		} catch {
			throw new Error("malformed context7 response body");
		}
	}
}
function record(value: unknown): Record<string, unknown> {
	ensure(value !== null && typeof value === "object" && !Array.isArray(value), "expected response object");
	return value as Record<string, unknown>;
}
function string(value: unknown): string {
	ensure(typeof value === "string", "expected response string");
	return value;
}
