import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Effort = "low" | "high" | "max";
export const EFFORT_ORDER: Effort[] = ["low", "high", "max"];

export interface ModelCfg {
	upstream: string;
	thinking: "enabled" | "disabled";
	default_effort?: Effort;
	max_effort?: Effort;
	public: Record<string, unknown>;
}

/** USD per 1M tokens equals nano-USD per token, so integer nano math is exact. */
export interface PriceNano {
	hit: number;
	miss: number;
	out: number;
}

export interface PriceEntry {
	peak: PriceNano;
	offpeak: PriceNano;
}

export interface GatewayConfig {
	models: Record<string, ModelCfg>;
	prices: {
		version: string;
		models: Record<string, PriceEntry>;
		windows: { days: string[]; hours: string[] };
		holidays: string[];
	};
	limits: {
		plans: Record<string, { monthly_token_cap: number }>;
		defaultMaxTokens: Record<string, number>;
		maxTokensCeiling: Record<string, number | null>;
		rpmPerKey: number | null;
		concurrentPerKey: number | null;
	};
	gateway: {
		upstreamBaseUrl: string;
		upstreamTimeoutMs: number;
		estimateCharsPerToken: number;
		features: { fim: boolean };
	};
}

/** Upstream brand pattern, built from parts so this file is not a hit for its own scrub. */
export const BRAND_RE = new RegExp(`${"deep"}${"seek"}|deep-${"seek"}|\\bds[-_ ]?v?\\d|V4\\.1-Flash|V4-Pro-0813`, "i");

function readJson(dir: string, name: string): any {
	return JSON.parse(readFileSync(join(dir, name), "utf8"));
}

export function toNano(usdPer1M: number, label: string): number {
	const n = Math.round(usdPer1M * 1000);
	if (!Number.isFinite(usdPer1M) || usdPer1M < 0 || Math.abs(n - usdPer1M * 1000) > 1e-6) {
		throw new Error(`price ${label}=${usdPer1M} is not an exact multiple of 0.001 USD per 1M tokens`);
	}
	return n;
}

function priceRow(r: any, label: string): PriceNano {
	return { hit: toNano(r.hit, `${label}.hit`), miss: toNano(r.miss, `${label}.miss`), out: toNano(r.out, `${label}.out`) };
}

export function loadConfig(dir: string): GatewayConfig {
	const m = readJson(dir, "models.json");
	const p = readJson(dir, "prices.json");
	const l = readJson(dir, "limits.json");
	const g = readJson(dir, "gateway.json");

	const prices: GatewayConfig["prices"] = {
		version: String(p.price_table_version),
		models: {},
		windows: p.peak_windows_kst,
		holidays: p.holidays_off_peak ?? [],
	};
	for (const [id, e] of Object.entries<any>(p.models)) {
		prices.models[id] = { peak: priceRow(e.peak, `${id}.peak`), offpeak: priceRow(e.offpeak, `${id}.offpeak`) };
	}
	const models: Record<string, ModelCfg> = m.models;
	for (const [id, mc] of Object.entries(models)) {
		if (!id.startsWith("OMK/")) throw new Error(`model id ${id} must start with OMK/`);
		if (!prices.models[mc.upstream]) throw new Error(`model ${id}: no price entry for upstream ${mc.upstream}`);
		if (BRAND_RE.test(id) || BRAND_RE.test(JSON.stringify(mc.public))) throw new Error(`model ${id}: public data must not carry the upstream brand`);
		if (mc.thinking === "enabled") {
			const d = EFFORT_ORDER.indexOf(mc.default_effort as Effort);
			const x = EFFORT_ORDER.indexOf(mc.max_effort as Effort);
			if (d < 0 || x < 0 || d > x) throw new Error(`model ${id}: need default_effort <= max_effort`);
		}
	}
	const config: GatewayConfig = {
		models,
		prices,
		limits: {
			plans: l.plans,
			defaultMaxTokens: l.per_request.default_max_tokens,
			maxTokensCeiling: l.per_request.max_tokens_ceiling,
			rpmPerKey: l.rpm_per_key ?? null,
			concurrentPerKey: l.concurrent_per_key ?? null,
		},
		gateway: {
			upstreamBaseUrl: String(g.upstream_base_url).replace(/\/+$/, ""),
			upstreamTimeoutMs: Number(g.upstream_timeout_ms),
			estimateCharsPerToken: Number(g.estimate_chars_per_token),
			features: { fim: Boolean(g.features?.fim) },
		},
	};
	for (const id of Object.keys(models)) {
		if (!((config.limits.defaultMaxTokens[id] ?? 0) > 0)) throw new Error(`limits: default_max_tokens missing for ${id}`);
	}
	return config;
}
