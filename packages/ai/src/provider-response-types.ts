export interface ProviderResponse {
	status: number;
	headers: Record<string, string>;
}

export interface ProviderRateLimitWindow {
	usedPercent: number;
	windowSeconds?: number;
	resetsAt?: number;
}

export interface ProviderRateLimitSnapshot {
	limitId?: string;
	primary?: ProviderRateLimitWindow;
	secondary?: ProviderRateLimitWindow;
}
