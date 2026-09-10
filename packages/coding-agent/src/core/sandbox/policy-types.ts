export type SandboxMode = "off" | "audit" | "enforce";
export type SandboxProfile = "readonly" | "workspace-write" | "dev-server" | "networked";
export type NetworkMode = "none" | "loopback" | "domain-allowlist" | "all-explicit";
export type PathAccessKind = "read" | "write";
export type SandboxPlatform = "linux" | "macos" | "unsupported";

export interface SandboxPolicy {
	mode: SandboxMode;
	profile: SandboxProfile;
	filesystem: {
		root: string;
		readAllow: readonly string[];
		readDeny: readonly string[];
		writeAllow: readonly string[];
		denyWrite: readonly string[];
		tempWrite: readonly string[];
		followSymlinks: false;
	};
	network: {
		mode: NetworkMode;
		allowedDomains: readonly string[];
		deniedDomains: readonly string[];
		allowUnixSockets: readonly string[];
		allowBrowser: false;
	};
	process: { allowExec: boolean; allowShell: boolean; allowPrivilege: false };
}
export interface ResolvedSandboxPath {
	requestedPath: string;
	exists: boolean;
	realPath?: string;
	nearestExistingParentRealPath?: string;
	isSymlink?: boolean;
	error?: string;
}
export type SandboxPathResolver = (requestPath: string) => ResolvedSandboxPath;
export interface PathAccessRequest {
	kind: PathAccessKind;
	path: string;
}
export interface SandboxDecision {
	allowed: boolean;
	rule: string;
	reason: string;
}
export interface NetworkAccessRequest {
	host?: string;
	url?: string;
	unixSocketPath?: string;
	browser?: boolean;
	loopback?: boolean;
}
export interface SandboxBackendStatus {
	platform: SandboxPlatform;
	backendAvailable: boolean;
	domainAllowlistAvailable?: boolean;
	/** Human-readable probe detail when the backend cannot enforce the policy. */
	unavailableReason?: string;
}
export interface SandboxFallbackDecision extends SandboxDecision {
	allowShell: boolean;
	allowExec: boolean;
	allowReadOnlyTools: boolean;
}
export interface BashSpawnPreflightContext {
	command: string;
	cwd: string;
}
export interface BashSpawnPreflightDecision extends SandboxDecision {
	allowShell: boolean;
}
