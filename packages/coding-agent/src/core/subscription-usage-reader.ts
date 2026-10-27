import type { AgentSession } from "./agent-session.ts";
import {
	getSubscriptionUsageRevision,
	getSubscriptionUsageSource,
	loadSubscriptionUsage,
	type SubscriptionUsageSnapshot,
} from "./provider-usage.ts";

type UsageFetcher = (session: AgentSession, provider?: string) => Promise<SubscriptionUsageSnapshot | undefined>;

interface UsageEntry {
	readonly owner: AgentSession;
	snapshot: SubscriptionUsageSnapshot | undefined;
	fetchedAt: number;
	revision: number;
	inFlight?: Promise<SubscriptionUsageSnapshot | undefined>;
}

/** Session/provider/revision-scoped quota snapshots shared by all UI consumers. */
export class SubscriptionUsageReader {
	private readonly entries = new Map<string, UsageEntry>();
	private readonly getSession: () => AgentSession;
	private readonly fetchUsage: UsageFetcher;
	private notify: (() => void) | undefined;

	constructor(getSession: () => AgentSession, fetchUsage?: UsageFetcher, notify?: () => void) {
		this.getSession = getSession;
		this.fetchUsage = fetchUsage ?? ((session, provider) => loadSubscriptionUsage(session, undefined, provider));
		this.notify = notify;
	}

	snapshot(provider: string): SubscriptionUsageSnapshot | undefined {
		return this.entries.get(provider)?.snapshot;
	}

	hasInFlight(provider: string): boolean {
		return this.entries.get(provider)?.inFlight !== undefined;
	}

	refresh(provider: string): Promise<SubscriptionUsageSnapshot | undefined> {
		const source = getSubscriptionUsageSource(provider);
		if (!source) {
			this.entries.delete(provider);
			return Promise.resolve(undefined);
		}
		const owner = this.getSession();
		const previous = this.entries.get(provider);
		if (previous && previous.owner !== owner) this.entries.delete(provider);
		const existing = this.entries.get(provider);
		if (existing?.inFlight) return existing.inFlight;
		const revision = getSubscriptionUsageRevision(provider);
		if (existing && existing.revision === revision && performance.now() - existing.fetchedAt < source.ttlMs) {
			return Promise.resolve(existing.snapshot);
		}
		const entry: UsageEntry = {
			owner,
			snapshot: existing?.snapshot,
			fetchedAt: performance.now(),
			revision,
		};
		this.entries.set(provider, entry);
		const request = (async (): Promise<SubscriptionUsageSnapshot | undefined> => {
			try {
				return await this.fetchUsage(owner, provider);
			} catch {
				return { label: source.label, windows: [], message: "usage unavailable" };
			}
		})();
		entry.inFlight = request;
		void request
			.then((snapshot) => {
				if (this.entries.get(provider) === entry) entry.snapshot = snapshot;
			})
			.finally(() => {
				if (this.entries.get(provider) === entry && entry.inFlight === request) entry.inFlight = undefined;
				try {
					this.notify?.();
				} catch {
					// A rendering callback cannot change the settled quota result.
				}
			});
		return request;
	}

	async read(provider: string): Promise<SubscriptionUsageSnapshot | undefined> {
		await this.refresh(provider);
		return this.snapshot(provider);
	}

	/** Stop UI notifications without abandoning or falsely settling active reads. */
	dispose(): void {
		this.notify = undefined;
	}
}
