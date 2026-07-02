import { createHash } from "node:crypto";

export type PublicMcpPresetKey =
	| "context7"
	| "exa"
	| "githubReadOnly"
	| "astGrep"
	| "repomixCodeCompact"
	| "omkLlmlinguaCompress"
	| "doclingUnderstand"
	| "markitdownLite"
	| "firecrawlWebUnderstand"
	| "deepwikiRepoUnderstandCandidate"
	| "insaneSearchCandidate"
	| "playwrightSandboxed"
	| "microsoftLearn"
	| "officialReferenceSafePack";

export type PublicMcpRisk = "R1" | "R2" | "R3";
export type PublicMcpLicense = "Apache-2.0" | "Apache-2.0/MIT/CC-BY-4.0" | "MIT" | "Unspecified";
export type PublicMcpImplementation = "candidate-wrapper" | "omk-owned" | "upstream-mcp";
export type PublicMcpReadiness = "candidate" | "stable";
export type PublicMcpUriScheme = "data" | "file" | "http" | "https";
export type PublicMcpTransport =
	| {
			readonly type: "http";
			readonly url: string;
	  }
	| {
			readonly type: "embedded-python-or-sidecar";
			readonly package: string;
	  }
	| {
			readonly type: "local-package";
			readonly package: string;
			readonly args?: readonly string[];
	  }
	| {
			readonly type: "stdio";
			readonly command: string;
			readonly args: readonly string[];
	  };

export interface PublicMcpAuthPolicy {
	readonly kind: "bearer" | "header" | "none";
	readonly header?: string;
	readonly secretRef?: string;
}

export interface PublicMcpSecretPolicy {
	readonly required?: readonly string[];
	readonly optional?: readonly string[];
	readonly headers?: Readonly<Record<string, string>>;
}

export interface PublicMcpToolPolicy {
	readonly allow: readonly string[];
	readonly conditionalAllow?: readonly string[];
	readonly deny?: readonly string[];
	readonly denyByDefault: boolean;
	readonly denyMutations?: boolean;
	readonly disabledByDefault?: readonly string[];
	readonly gated?: readonly string[];
	readonly requirePostconditions?: readonly string[];
}

export interface PublicMcpRuntimePolicy {
	readonly absolutePathMustBeUnderWorkspace?: boolean;
	readonly allowedUriSchemes?: readonly PublicMcpUriScheme[];
	readonly authenticationBoundaryRequired?: boolean;
	readonly blockMetadataIp?: boolean;
	readonly blockHttpByDefault?: boolean;
	readonly blockNetworkUrlsByDefault?: boolean;
	readonly blockPrivateNetwork?: boolean;
	readonly blockRemoteRepositoryByDefault?: boolean;
	readonly cacheDocuments?: boolean;
	readonly cacheable?: boolean;
	readonly cacheMaterializedOutputs?: boolean;
	readonly defaultCompressionRatio?: number;
	readonly descriptorHashPinned?: boolean;
	readonly distillBeforeMainContext?: boolean;
	readonly disableAutoInstall?: boolean;
	readonly domainAllowlistOptional?: boolean;
	readonly denyYoutubeByDefault?: boolean;
	readonly denyZipByDefault?: boolean;
	readonly evidenceLedger?: boolean;
	readonly filesystemRoot?: string;
	readonly fileRoot?: string;
	readonly forkContext?: boolean;
	readonly ledger?: boolean;
	readonly localFilesUnderWorkspaceOnly?: boolean;
	readonly localOnly?: boolean;
	readonly maxBrowserActions?: number;
	readonly maxCompressionRatio?: number;
	readonly maxInputBytes?: number;
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	readonly maxResults?: number;
	readonly maxUrlsPerTask?: number;
	readonly markdownFullPageRequiresExplicitNeed?: boolean;
	readonly mutationsRequireHumanGate?: boolean;
	readonly mutationsRequirePostconditions?: boolean;
	readonly noFilesystemReadExceptModelCache?: boolean;
	readonly noNetwork?: boolean;
	readonly noSecrets?: boolean;
	readonly noShell?: boolean;
	readonly outputGuard?: boolean;
	readonly preferGrepBeforeFullRead?: boolean;
	readonly preferIncrementalRead?: boolean;
	readonly preferJsonExtraction?: boolean;
	readonly privateRepoDeniedByDefault?: boolean;
	readonly promptTaint?: "external-docs" | "external-web" | "browser";
	readonly publicContentOnly?: boolean;
	readonly publicReposOnly?: boolean;
	readonly readOnly?: boolean;
	readonly recordEvidence?: boolean;
	readonly rejectIfCoverageBelow?: {
		readonly hard: number;
		readonly high: number;
		readonly low: number;
		readonly medium: number;
	};
	readonly requireCoverageVerification?: boolean;
	readonly requireOriginAllowlistForScrape?: boolean;
	readonly requiresExplicitPostconditions?: boolean;
	readonly requiresOriginAllowlist?: boolean;
	readonly requiresSandbox?: boolean;
	readonly secretBrokerOnly?: boolean;
	readonly secretScanRequired?: boolean;
	readonly ssrfGuard?: boolean;
	readonly workspaceReadOnly?: boolean;
}

export interface PublicMcpPreset {
	readonly defaultEnabled?: boolean;
	readonly id: string;
	readonly key: PublicMcpPresetKey;
	readonly license: PublicMcpLicense;
	readonly notes: readonly string[];
	readonly policy: PublicMcpRuntimePolicy;
	readonly implementation?: PublicMcpImplementation;
	readonly readiness?: PublicMcpReadiness;
	readonly risk: PublicMcpRisk;
	readonly sourceUrls: readonly string[];
	readonly tools: PublicMcpToolPolicy;
	readonly auth?: PublicMcpAuthPolicy;
	readonly secrets?: PublicMcpSecretPolicy;
	readonly servers?: readonly string[];
	readonly transport?: PublicMcpTransport;
}

export interface PublicMcpObservedTool {
	readonly name: string;
	readonly descriptorHash: string;
	readonly description: string;
}

export interface PublicMcpObservedServer {
	readonly serverIdentity: string;
	readonly tools: readonly PublicMcpObservedTool[];
}

export interface PublicMcpApprovedServer {
	readonly serverIdentity: string;
	readonly tools: Readonly<Record<string, string>>;
}

export type PublicMcpAdmissionStatus = "allow" | "quarantine";

export interface PublicMcpAdmissionDecision {
	readonly status: PublicMcpAdmissionStatus;
	readonly reasons: readonly string[];
}

export type PublicMcpHashable =
	| null
	| boolean
	| number
	| string
	| readonly PublicMcpHashable[]
	| {
			readonly [key: string]: PublicMcpHashable;
	  };

export const PUBLIC_MCP_PRESETS = {
	context7: {
		id: "context7",
		key: "context7",
		license: "MIT",
		notes: ["Documentation retrieval preset; optional API key only raises rate limits."],
		risk: "R1",
		sourceUrls: ["https://github.com/upstash/context7"],
		transport: {
			type: "http",
			url: "https://mcp.context7.com/mcp",
		},
		secrets: {
			optional: ["CONTEXT7_API_KEY"],
			headers: {
				CONTEXT7_API_KEY: "secret-ref:context7",
			},
		},
		tools: {
			allow: ["resolve-library-id", "query-docs"],
			denyByDefault: true,
		},
		policy: {
			cacheable: true,
			maxOutputTokens: 6000,
			outputGuard: true,
			promptTaint: "external-docs",
			readOnly: true,
		},
	},
	exa: {
		id: "exa",
		key: "exa",
		license: "MIT",
		notes: ["Run searches in forked context and return distilled output to the main task."],
		risk: "R1",
		sourceUrls: ["https://github.com/exa-labs/exa-mcp-server"],
		transport: {
			type: "http",
			url: "https://mcp.exa.ai/mcp",
		},
		auth: {
			kind: "header",
			header: "Authorization",
			secretRef: "secret-ref:exa_api_key",
		},
		secrets: {
			optional: ["EXA_API_KEY"],
		},
		tools: {
			allow: ["web_search_exa", "web_fetch_exa"],
			conditionalAllow: ["web_search_advanced_exa"],
			denyByDefault: true,
		},
		policy: {
			blockPrivateNetwork: true,
			distillBeforeMainContext: true,
			domainAllowlistOptional: true,
			forkContext: true,
			maxOutputTokens: 5000,
			maxResults: 10,
			ssrfGuard: true,
		},
	},
	githubReadOnly: {
		id: "github-readonly",
		key: "githubReadOnly",
		license: "MIT",
		notes: ["Read-only GitHub MCP profile; mutation tools remain gated for future explicit workflows."],
		risk: "R2",
		sourceUrls: ["https://github.com/github/github-mcp-server"],
		transport: {
			type: "http",
			url: "https://api.githubcopilot.com/mcp/",
		},
		auth: {
			kind: "bearer",
			secretRef: "secret-ref:github_pat",
		},
		secrets: {
			required: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
		},
		tools: {
			allow: [
				"actions_list",
				"get_file_contents",
				"issue_read",
				"list_issues",
				"list_pull_requests",
				"pull_request_read",
				"search_code",
				"search_issues",
				"search_pull_requests",
				"search_repositories",
			],
			denyByDefault: true,
			requirePostconditions: [
				"add_comment_to_pending_review",
				"create_branch",
				"create_or_update_file",
				"create_pull_request",
				"delete_file",
				"issue_write",
				"merge_pull_request",
				"pull_request_review_write",
				"push_files",
				"update_pull_request",
				"update_pull_request_branch",
			],
		},
		policy: {
			ledger: true,
			maxOutputTokens: 8000,
			mutationsRequireHumanGate: true,
			readOnly: true,
			secretBrokerOnly: true,
		},
	},
	astGrep: {
		id: "ast-grep",
		key: "astGrep",
		license: "MIT",
		notes: ["Experimental upstream; pin descriptor and wrap execution before broad enablement."],
		risk: "R1",
		sourceUrls: ["https://github.com/ast-grep/ast-grep-mcp"],
		transport: {
			type: "stdio",
			command: "uvx",
			args: ["--from", "git+https://github.com/ast-grep/ast-grep-mcp", "ast-grep-server"],
		},
		tools: {
			allow: ["dump_syntax_tree", "find_code", "find_code_by_rule", "test_match_code_rule"],
			denyByDefault: true,
		},
		policy: {
			descriptorHashPinned: true,
			maxResults: 200,
			noShell: true,
			workspaceReadOnly: true,
		},
	},
	repomixCodeCompact: {
		defaultEnabled: true,
		id: "repomix-code-compact",
		implementation: "upstream-mcp",
		key: "repomixCodeCompact",
		license: "MIT",
		notes: [
			"Codebase packing and compression preset; remote repository packing is disabled until a task explicitly opts in.",
			"Use grep/read against packed output before full-context attachment.",
		],
		readiness: "stable",
		risk: "R1",
		sourceUrls: ["https://github.com/yamadashy/repomix"],
		transport: {
			type: "stdio",
			command: "npx",
			args: ["-y", "repomix", "--mcp"],
		},
		tools: {
			allow: [
				"attach_packed_output",
				"file_system_read_directory",
				"grep_repomix_output",
				"pack_codebase",
				"read_repomix_output",
			],
			disabledByDefault: ["pack_remote_repository"],
			gated: ["file_system_read_file"],
			denyByDefault: true,
		},
		policy: {
			absolutePathMustBeUnderWorkspace: true,
			blockRemoteRepositoryByDefault: true,
			descriptorHashPinned: true,
			evidenceLedger: true,
			maxOutputTokens: 120_000,
			outputGuard: true,
			preferGrepBeforeFullRead: true,
			preferIncrementalRead: true,
			secretScanRequired: true,
			workspaceReadOnly: true,
		},
	},
	omkLlmlinguaCompress: {
		defaultEnabled: true,
		id: "omk-llmlingua-compress",
		implementation: "omk-owned",
		key: "omkLlmlinguaCompress",
		license: "MIT",
		notes: [
			"First-party wrapper target for LLMLingua-style prompt and context compression.",
			"System prompts, latest user turns, and tool schemas must stay outside lossy compression.",
		],
		readiness: "stable",
		risk: "R1",
		sourceUrls: ["https://github.com/microsoft/LLMLingua", "https://arxiv.org/abs/2403.12968"],
		transport: {
			type: "embedded-python-or-sidecar",
			package: "llmlingua",
		},
		tools: {
			allow: [
				"compress_context_items",
				"compress_messages",
				"compress_prompt",
				"compress_representation_candidate",
				"verify_compression_coverage",
			],
			denyByDefault: true,
		},
		policy: {
			cacheMaterializedOutputs: true,
			defaultCompressionRatio: 3,
			evidenceLedger: true,
			localOnly: true,
			maxCompressionRatio: 8,
			maxInputTokens: 200_000,
			noFilesystemReadExceptModelCache: true,
			noNetwork: true,
			outputGuard: true,
			rejectIfCoverageBelow: {
				hard: 0.95,
				high: 0.8,
				medium: 0.55,
				low: 0.3,
			},
			requireCoverageVerification: true,
		},
	},
	doclingUnderstand: {
		defaultEnabled: true,
		id: "docling-understand",
		implementation: "upstream-mcp",
		key: "doclingUnderstand",
		license: "MIT",
		notes: [
			"Structured document understanding preset for PDFs, Office files, tables, OCR, and layout-sensitive conversions.",
			"Parser attack surface requires sandboxing and workspace-only local file access.",
		],
		readiness: "stable",
		risk: "R2",
		sourceUrls: ["https://github.com/docling-project/docling", "https://github.com/docling-project/docling-mcp"],
		transport: {
			type: "stdio",
			command: "uvx",
			args: ["--from=docling-mcp", "docling-mcp-server", "--transport", "stdio"],
		},
		tools: {
			allow: ["convert_document", "export_docling_document_to_json", "export_docling_document_to_markdown"],
			gated: ["create_new_docling_document", "save_docling_document"],
			denyByDefault: true,
		},
		policy: {
			blockNetworkUrlsByDefault: true,
			cacheDocuments: true,
			evidenceLedger: true,
			localFilesUnderWorkspaceOnly: true,
			maxInputBytes: 80_000_000,
			maxOutputTokens: 80_000,
			outputGuard: true,
			requiresSandbox: true,
		},
	},
	markitdownLite: {
		defaultEnabled: true,
		id: "markitdown-lite",
		implementation: "upstream-mcp",
		key: "markitdownLite",
		license: "MIT",
		notes: [
			"Lightweight Markdown conversion fallback for local files and data URIs.",
			"HTTP, ZIP, and YouTube inputs stay blocked until a task explicitly needs them.",
		],
		readiness: "stable",
		risk: "R2",
		sourceUrls: [
			"https://github.com/microsoft/markitdown",
			"https://github.com/microsoft/markitdown/tree/main/packages/markitdown-mcp",
		],
		transport: {
			type: "stdio",
			command: "markitdown-mcp",
			args: [],
		},
		tools: {
			allow: ["convert_to_markdown"],
			denyByDefault: true,
		},
		policy: {
			allowedUriSchemes: ["file", "data"],
			blockHttpByDefault: true,
			denyYoutubeByDefault: true,
			denyZipByDefault: true,
			evidenceLedger: true,
			fileRoot: "workspaceRoot",
			maxInputBytes: 30_000_000,
			maxOutputTokens: 50_000,
			outputGuard: true,
			requiresSandbox: true,
		},
	},
	firecrawlWebUnderstand: {
		defaultEnabled: false,
		id: "firecrawl-web-understand",
		implementation: "upstream-mcp",
		key: "firecrawlWebUnderstand",
		license: "MIT",
		notes: [
			"Opt-in live web understanding preset; search and scrape are the only default-admissible tools.",
			"Prefer JSON extraction over full-page Markdown to protect the context budget.",
		],
		readiness: "stable",
		risk: "R2",
		sourceUrls: ["https://github.com/firecrawl/firecrawl-mcp-server"],
		transport: {
			type: "http",
			url: "https://mcp.firecrawl.dev/v2/mcp",
		},
		auth: {
			kind: "bearer",
			secretRef: "secret-ref:firecrawl_api_key",
		},
		secrets: {
			optional: ["FIRECRAWL_API_KEY", "FIRECRAWL_OAUTH_TOKEN"],
		},
		tools: {
			allow: ["firecrawl_scrape", "firecrawl_search"],
			disabledByDefault: ["firecrawl_agent", "firecrawl_crawl", "firecrawl_interact", "firecrawl_monitor"],
			gated: ["firecrawl_extract", "firecrawl_map", "firecrawl_research"],
			denyByDefault: true,
		},
		policy: {
			blockMetadataIp: true,
			blockPrivateNetwork: true,
			distillBeforeMainContext: true,
			evidenceLedger: true,
			forkContext: true,
			markdownFullPageRequiresExplicitNeed: true,
			maxOutputTokens: 40_000,
			maxUrlsPerTask: 10,
			outputGuard: true,
			preferJsonExtraction: true,
			requireOriginAllowlistForScrape: true,
		},
	},
	deepwikiRepoUnderstandCandidate: {
		defaultEnabled: false,
		id: "deepwiki-repo-understand",
		implementation: "candidate-wrapper",
		key: "deepwikiRepoUnderstandCandidate",
		license: "Unspecified",
		notes: [
			"Candidate only until an official MCP endpoint, tool schema, auth model, and retention boundary are verified.",
			"Remote repository indexing is public-repo-only by default.",
		],
		readiness: "candidate",
		risk: "R2",
		sourceUrls: ["https://deepwiki.com/"],
		tools: {
			allow: [],
			denyByDefault: true,
		},
		policy: {
			descriptorHashPinned: true,
			evidenceLedger: true,
			noSecrets: true,
			outputGuard: true,
			privateRepoDeniedByDefault: true,
			publicReposOnly: true,
		},
	},
	insaneSearchCandidate: {
		defaultEnabled: false,
		id: "insane-search-public-reader",
		implementation: "candidate-wrapper",
		key: "insaneSearchCandidate",
		license: "MIT",
		notes: [
			"Candidate only: upstream is a Claude Code plugin, not a verified standalone MCP transport.",
			"Any OMK integration must be a sandboxed first-party wrapper around public-content reads, with auto-install disabled.",
		],
		readiness: "candidate",
		risk: "R3",
		sourceUrls: ["https://github.com/fivetaku/insane-search"],
		tools: {
			allow: ["insane_search_public_read"],
			disabledByDefault: ["insane_search_auto_install_dependencies"],
			gated: ["insane_search_browser_escalation"],
			denyByDefault: true,
		},
		policy: {
			authenticationBoundaryRequired: true,
			blockMetadataIp: true,
			blockPrivateNetwork: true,
			disableAutoInstall: true,
			distillBeforeMainContext: true,
			evidenceLedger: true,
			forkContext: true,
			maxBrowserActions: 20,
			maxOutputTokens: 30_000,
			outputGuard: true,
			publicContentOnly: true,
			requiresOriginAllowlist: true,
			requiresSandbox: true,
		},
	},
	playwrightSandboxed: {
		id: "playwright-sandboxed",
		key: "playwrightSandboxed",
		license: "Apache-2.0",
		notes: ["Browser automation preset; enable only with sandbox and origin controls."],
		risk: "R3",
		sourceUrls: ["https://github.com/microsoft/playwright-mcp"],
		transport: {
			type: "local-package",
			package: "@playwright/mcp",
		},
		tools: {
			allow: [
				"browser_close",
				"browser_click",
				"browser_navigate",
				"browser_snapshot",
				"browser_type",
				"browser_wait_for",
			],
			deny: ["browser_console_messages", "browser_file_upload", "browser_pdf_save", "browser_press_key"],
			denyByDefault: true,
		},
		policy: {
			blockMetadataIp: true,
			blockPrivateNetwork: true,
			ledger: true,
			maxBrowserActions: 40,
			recordEvidence: true,
			requiresExplicitPostconditions: true,
			requiresOriginAllowlist: true,
			requiresSandbox: true,
		},
	},
	microsoftLearn: {
		id: "microsoft-learn",
		key: "microsoftLearn",
		license: "Unspecified",
		notes: ["Microsoft official remote documentation endpoint from the Microsoft MCP catalog."],
		risk: "R1",
		sourceUrls: ["https://github.com/microsoft/mcp"],
		transport: {
			type: "http",
			url: "https://learn.microsoft.com/api/mcp",
		},
		tools: {
			allow: ["*"],
			denyByDefault: true,
			denyMutations: true,
		},
		policy: {
			cacheable: true,
			maxOutputTokens: 6000,
			outputGuard: true,
			promptTaint: "external-docs",
			readOnly: true,
		},
	},
	officialReferenceSafePack: {
		id: "official-reference-safe-pack",
		key: "officialReferenceSafePack",
		license: "Apache-2.0/MIT/CC-BY-4.0",
		notes: ["Reference implementations only; wrap before production use."],
		risk: "R1",
		sourceUrls: ["https://github.com/modelcontextprotocol/servers"],
		servers: ["time", "memory", "sequential-thinking", "git-readonly"],
		tools: {
			allow: [],
			denyByDefault: true,
		},
		policy: {
			blockPrivateNetwork: true,
			descriptorHashPinned: true,
			filesystemRoot: "workspaceRoot",
			mutationsRequirePostconditions: true,
		},
	},
} as const satisfies Record<PublicMcpPresetKey, PublicMcpPreset>;

export const OMK_PUBLIC_CONTEXT_MCP_BUNDLE = {
	stableDefaults: ["repomix-code-compact", "docling-understand", "markitdown-lite", "omk-llmlingua-compress"],
	optInResearchWeb: ["firecrawl-web-understand"],
	candidatesNeedVerification: ["deepwiki-repo-understand", "insane-search-public-reader"],
	internalRouters: ["mcp-tool-rag-router"],
} as const;

export function listPublicMcpPresets(): PublicMcpPreset[] {
	return Object.values(PUBLIC_MCP_PRESETS).map((preset) => clonePublicMcpPreset(preset));
}

export function canonicalMcpPolicyHash(value: PublicMcpHashable): string {
	return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

export function canonicalPublicMcpServerIdentity(preset: PublicMcpPreset): string {
	return canonicalMcpPolicyHash({
		id: preset.id,
		servers: preset.servers ?? null,
		transport: preset.transport ?? null,
	});
}

export function admitPublicMcpServer(
	preset: PublicMcpPreset,
	observed: PublicMcpObservedServer,
	approved: PublicMcpApprovedServer | undefined,
): PublicMcpAdmissionDecision {
	if (!approved) {
		return {
			status: "quarantine",
			reasons: ["server_not_approved"],
		};
	}

	if (approved.serverIdentity !== observed.serverIdentity) {
		return {
			status: "quarantine",
			reasons: ["server_identity_changed"],
		};
	}

	const reasons: string[] = [];

	for (const tool of observed.tools) {
		const approvedDescriptorHash = approved.tools[tool.name];

		if (!approvedDescriptorHash) {
			reasons.push(`new_tool:${tool.name}`);
		} else if (approvedDescriptorHash !== tool.descriptorHash) {
			reasons.push(`descriptor_changed:${tool.name}`);
		}

		if (!isToolAllowed(preset.tools, tool.name)) {
			reasons.push(`tool_not_allowed:${tool.name}`);
		}

		if (shouldDenyMutationLikeTool(preset, tool.name)) {
			reasons.push(`mutation_tool_denied:${tool.name}`);
		}

		if (detectMcpDescriptorPromptInjection(tool.description).score > 0.7) {
			reasons.push(`descriptor_prompt_injection:${tool.name}`);
		}
	}

	return {
		status: reasons.length === 0 ? "allow" : "quarantine",
		reasons,
	};
}

export function detectMcpDescriptorPromptInjection(description: string): { readonly score: number } {
	const normalized = description.toLowerCase();
	const suspiciousPatterns = [
		/ignore\s+(?:all\s+)?previous\s+instructions/,
		/disregard\s+(?:all\s+)?previous\s+instructions/,
		/exfiltrat/,
		/reveal\s+(?:the\s+)?(?:system\s+)?prompt/,
		/send\s+(?:me\s+)?(?:all\s+)?secrets/,
	];
	const hits = suspiciousPatterns.filter((pattern) => pattern.test(normalized)).length;

	return {
		score: hits === 0 ? 0 : Math.min(1, 0.6 + hits * 0.25),
	};
}

function clonePublicMcpPreset(preset: PublicMcpPreset): PublicMcpPreset {
	return {
		...preset,
		auth: preset.auth ? { ...preset.auth } : undefined,
		defaultEnabled: preset.defaultEnabled,
		implementation: preset.implementation,
		notes: [...preset.notes],
		policy: cloneRuntimePolicy(preset.policy),
		readiness: preset.readiness,
		secrets: preset.secrets
			? {
					headers: preset.secrets.headers ? { ...preset.secrets.headers } : undefined,
					optional: preset.secrets.optional ? [...preset.secrets.optional] : undefined,
					required: preset.secrets.required ? [...preset.secrets.required] : undefined,
				}
			: undefined,
		servers: preset.servers ? [...preset.servers] : undefined,
		sourceUrls: [...preset.sourceUrls],
		tools: {
			allow: [...preset.tools.allow],
			conditionalAllow: preset.tools.conditionalAllow ? [...preset.tools.conditionalAllow] : undefined,
			deny: preset.tools.deny ? [...preset.tools.deny] : undefined,
			denyByDefault: preset.tools.denyByDefault,
			denyMutations: preset.tools.denyMutations,
			disabledByDefault: preset.tools.disabledByDefault ? [...preset.tools.disabledByDefault] : undefined,
			gated: preset.tools.gated ? [...preset.tools.gated] : undefined,
			requirePostconditions: preset.tools.requirePostconditions
				? [...preset.tools.requirePostconditions]
				: undefined,
		},
		transport: preset.transport ? cloneTransport(preset.transport) : undefined,
	};
}

function cloneTransport(transport: PublicMcpTransport): PublicMcpTransport {
	if (transport.type === "stdio") {
		return {
			...transport,
			args: [...transport.args],
		};
	}

	if (transport.type === "local-package") {
		return {
			...transport,
			args: transport.args ? [...transport.args] : undefined,
		};
	}

	if (transport.type === "embedded-python-or-sidecar") {
		return { ...transport };
	}

	return { ...transport };
}

function cloneRuntimePolicy(policy: PublicMcpRuntimePolicy): PublicMcpRuntimePolicy {
	return {
		...policy,
		allowedUriSchemes: policy.allowedUriSchemes ? [...policy.allowedUriSchemes] : undefined,
		rejectIfCoverageBelow: policy.rejectIfCoverageBelow ? { ...policy.rejectIfCoverageBelow } : undefined,
	};
}

function isToolAllowed(policy: PublicMcpToolPolicy, toolName: string): boolean {
	if (policy.deny?.includes(toolName)) {
		return false;
	}

	if (policy.allow.includes("*")) {
		return true;
	}

	return policy.allow.includes(toolName);
}

function shouldDenyMutationLikeTool(preset: PublicMcpPreset, toolName: string): boolean {
	if (!preset.tools.allow.includes("*")) {
		return false;
	}

	if (!preset.tools.denyMutations && !preset.policy.readOnly && !preset.policy.mutationsRequirePostconditions) {
		return false;
	}

	return isMutationLikeToolName(toolName);
}

function isMutationLikeToolName(toolName: string): boolean {
	return /(?:^|[_-])(add|approve|archive|cancel|close|create|delete|dismiss|merge|post|push|remove|send|submit|update|upload|write)(?:$|[_-])/.test(
		toolName.toLowerCase(),
	);
}

function canonicalStringify(value: PublicMcpHashable): string {
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
	}

	const record = value as { readonly [key: string]: PublicMcpHashable };
	const keys = Object.keys(record).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`).join(",")}}`;
}
