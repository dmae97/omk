import type { ModelThinkingLevel } from "../types.ts";
import { readUnary } from "./devin-connect.ts";
import { field, ProtoMessage } from "./devin-protobuf.ts";

export const DEVIN_BASE_URL = "https://server.codeium.com";
const TOKEN_PREFIX = "devin-session-token$";
const CLI_VERSION = "3000.10.21";

export function normalizeDevinToken(token: string): string {
	const trimmed = token.trim();
	if (!trimmed || trimmed === TOKEN_PREFIX || /\s/.test(trimmed))
		throw new Error("Missing or invalid Devin CLI session token; run /login devin");
	return trimmed.startsWith(TOKEN_PREFIX) ? trimmed : `${TOKEN_PREFIX}${trimmed}`;
}

export function assertDevinOrigin(baseUrl: string): void {
	if (baseUrl.replace(/\/+$/, "") !== DEVIN_BASE_URL) {
		throw new Error("Devin subscription credentials require the fixed server.codeium.com HTTPS origin");
	}
}

export function devinMetadata(token: string, jwt = ""): Buffer {
	return Buffer.concat([
		field(1, "devin-cli"),
		field(2, CLI_VERSION),
		field(3, normalizeDevinToken(token)),
		field(4, "en"),
		field(5, process.platform === "win32" ? "windows" : process.platform),
		field(6, true),
		field(7, CLI_VERSION),
		field(12, "chisel"),
		field(21, jwt),
		field(28, "chisel"),
	]);
}

export type DevinFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function devinUnary(
	path: string,
	payload: Uint8Array,
	signal: AbortSignal,
	fetchImpl: DevinFetch = fetch,
): Promise<ProtoMessage> {
	signal.throwIfAborted();
	const response = await fetchImpl(`${DEVIN_BASE_URL}${path}`, {
		method: "POST",
		redirect: "error",
		signal,
		headers: { "Content-Type": "application/proto", "Connect-Protocol-Version": "1" },
		body: Buffer.from(payload),
	});
	return new ProtoMessage(await readUnary(response));
}

export async function getDevinJwt(token: string, signal: AbortSignal): Promise<string> {
	const result = await devinUnary("/exa.auth_pb.AuthService/GetUserJwt", field(1, devinMetadata(token)), signal);
	const jwt = result.string(1);
	if (!jwt) throw new Error("Devin rejected the saved login; run /login devin");
	const customOrigin = result.string(2);
	if (customOrigin) assertDevinOrigin(customOrigin);
	return jwt;
}

/** Local `contextWindow` at or above which OMK asks for the family's separate 1M-context lane. */
export const DEVIN_LONG_CONTEXT_TOKENS = 1_000_000;

export interface DevinRoute {
	uid: string;
	contextWindow: number;
	maxTokens: number;
	/** True when the wire UID belongs to the family's separate 1M-context lane. */
	longContext: boolean;
}

export interface DevinRouteOptions {
	/**
	 * Prefer the 1M-context lane when the account catalog declares one. The standard lane
	 * is used when the catalog has no 1M lane; the caller then compares the declared window.
	 */
	longContext?: boolean;
}

/**
 * Resolve only server-declared SWE-2 efforts, never synthesize a wire UID from a label.
 * Fast-lane entries are always excluded. 1M-context entries form a separate lane that is
 * selected only through `options.longContext`; the two lanes are never mixed.
 */
export function resolveDevinRoute(
	catalog: ProtoMessage,
	effort: ModelThinkingLevel,
	options: DevinRouteOptions = {},
): DevinRoute {
	const candidates: DevinRoute[] = [];
	for (const config of catalog.messages(1)) {
		if (config.number(4)) continue;
		const info = config.messages(23)[0];
		if (info?.number(2) || info?.number(25) || [4, 6].includes(info?.number(22) ?? 0)) continue;
		const family = config.messages(30)[0];
		if (
			family
				?.string(1)
				.toLowerCase()
				.replace(/[^a-z0-9]/g, "") !== "swe2"
		)
			continue;
		let declaredEffort = "";
		let fastLane = false;
		let longContext = false;
		for (const entry of family.messages(2)) {
			const key = entry
				.string(1)
				.toLowerCase()
				.replace(/[^a-z0-9]/g, "");
			const value = entry.messages(2)[0];
			if (key === "effort" || key === "reasoningeffort") declaredEffort = value?.string(2).toLowerCase() ?? "";
			if (key === "fastmode" && value?.number(1) === 1) fastLane = true;
			if (key === "1mcontext" && value?.number(1) === 1) longContext = true;
		}
		if (fastLane || declaredEffort !== effort) continue;
		const uid = config.string(22);
		if (!uid) continue;
		candidates.push({
			uid,
			contextWindow: config.number(18) || info?.number(4) || 0,
			maxTokens: info?.number(13) || 0,
			longContext,
		});
	}
	const wantLong = options.longContext === true && candidates.some((candidate) => candidate.longContext);
	const matches = candidates.filter((candidate) => candidate.longContext === wantLong);
	if (matches.length !== 1)
		throw new Error(
			`Devin SWE-2 ${effort}${wantLong ? " (1M context)" : ""} unavailable or ambiguous in this account's model catalog; check devin models list`,
		);
	return matches[0];
}

export async function getDevinRoute(
	token: string,
	effort: ModelThinkingLevel,
	signal: AbortSignal,
	options: DevinRouteOptions = {},
): Promise<DevinRoute> {
	const metadata = Buffer.concat([devinMetadata(token), field(30, 8)]);
	const catalog = await devinUnary(
		"/exa.api_server_pb.ApiServerService/GetCliModelConfigs",
		field(1, metadata),
		signal,
	);
	return resolveDevinRoute(catalog, effort, options);
}

const DEVIN_USER_STATUS_PATH = "/exa.seat_management_pb.SeatManagementService/GetUserStatus";

/** Account plan and quota state decoded from `GetUserStatus` (exa.seat_management_pb). */
export interface DevinUserStatus {
	readonly planName?: string;
	readonly accountDisplayName?: string;
	readonly name?: string;
	readonly email?: string;
	/** `PlanInfo.teams_tier` enum value; 0 means unspecified. */
	readonly teamsTier?: number;
	/** `PlanInfo.billing_strategy` enum value (1 credits, 2 quota, 3 ACU); 0 means unspecified. */
	readonly billingStrategy?: number;
	readonly hideDailyQuota?: boolean;
	readonly hideWeeklyQuota?: boolean;
	/** `PlanStatus.daily_quota_remaining_percent` (0-100), only when the field was on the wire. */
	readonly dailyQuotaRemainingPercent?: number;
	readonly weeklyQuotaRemainingPercent?: number;
	readonly dailyQuotaResetAt?: number;
	readonly weeklyQuotaResetAt?: number;
	readonly availablePromptCredits?: number;
	readonly availableFlowCredits?: number;
	readonly availableFlexCredits?: number;
	readonly usedPromptCredits?: number;
	readonly usedFlowCredits?: number;
	readonly usedFlexCredits?: number;
	readonly planStart?: number;
	readonly planEnd?: number;
	readonly overageBalanceMicros?: number;
}

function devinNumber(message: ProtoMessage | undefined, no: number): number | undefined {
	if (!message?.has(no)) return undefined;
	try {
		return message.number(no);
	} catch {
		// Some wire fields carry a uint64 max sentinel for "unlimited" (e.g.
		// credit balances on quota plans). Those cannot be represented as a JS
		// number; report the field as absent instead of failing the decode.
		return undefined;
	}
}

function devinText(message: ProtoMessage | undefined, no: number): string | undefined {
	const value = message?.string(no).trim();
	return value ? value : undefined;
}

function devinTimestampSeconds(message: ProtoMessage | undefined): number | undefined {
	const seconds = message?.number(1);
	return seconds !== undefined && seconds > 0 ? seconds : undefined;
}

/** Decode `GetUserStatusResponse` into the plan/quota fields the usage rail consumes. */
export function parseDevinUserStatus(response: ProtoMessage): DevinUserStatus {
	const userStatus = response.messages(1)[0];
	const planStatus = userStatus?.messages(13)[0];
	const responsePlanInfo = response.messages(2)[0];
	const statusPlanInfo = planStatus?.messages(1)[0];
	const devinInfo = responsePlanInfo?.messages(33)[0] ?? statusPlanInfo?.messages(33)[0];
	const planInfo = responsePlanInfo ?? statusPlanInfo;
	return {
		...(devinText(planInfo, 2) !== undefined ? { planName: devinText(planInfo, 2) } : {}),
		...(devinText(devinInfo, 8) !== undefined ? { accountDisplayName: devinText(devinInfo, 8) } : {}),
		...(devinText(userStatus, 3) !== undefined ? { name: devinText(userStatus, 3) } : {}),
		...(devinText(userStatus, 7) !== undefined ? { email: devinText(userStatus, 7) } : {}),
		...(devinNumber(planInfo, 1) !== undefined ? { teamsTier: devinNumber(planInfo, 1) } : {}),
		...(devinNumber(planInfo, 35) !== undefined ? { billingStrategy: devinNumber(planInfo, 35) } : {}),
		...(planInfo?.has(36) ? { hideDailyQuota: planInfo.number(36) === 1 } : {}),
		...(planInfo?.has(37) ? { hideWeeklyQuota: planInfo.number(37) === 1 } : {}),
		...(devinNumber(planStatus, 14) !== undefined ? { dailyQuotaRemainingPercent: devinNumber(planStatus, 14) } : {}),
		...(devinNumber(planStatus, 15) !== undefined
			? { weeklyQuotaRemainingPercent: devinNumber(planStatus, 15) }
			: {}),
		...(devinNumber(planStatus, 17) !== undefined ? { dailyQuotaResetAt: devinNumber(planStatus, 17) } : {}),
		...(devinNumber(planStatus, 18) !== undefined ? { weeklyQuotaResetAt: devinNumber(planStatus, 18) } : {}),
		...(devinNumber(planStatus, 8) !== undefined ? { availablePromptCredits: devinNumber(planStatus, 8) } : {}),
		...(devinNumber(planStatus, 9) !== undefined ? { availableFlowCredits: devinNumber(planStatus, 9) } : {}),
		...(devinNumber(planStatus, 4) !== undefined ? { availableFlexCredits: devinNumber(planStatus, 4) } : {}),
		...(devinNumber(planStatus, 6) !== undefined ? { usedPromptCredits: devinNumber(planStatus, 6) } : {}),
		...(devinNumber(planStatus, 5) !== undefined ? { usedFlowCredits: devinNumber(planStatus, 5) } : {}),
		...(devinNumber(planStatus, 7) !== undefined ? { usedFlexCredits: devinNumber(planStatus, 7) } : {}),
		...(devinTimestampSeconds(planStatus?.messages(2)[0]) !== undefined
			? { planStart: devinTimestampSeconds(planStatus?.messages(2)[0]) }
			: {}),
		...(devinTimestampSeconds(planStatus?.messages(3)[0]) !== undefined
			? { planEnd: devinTimestampSeconds(planStatus?.messages(3)[0]) }
			: {}),
		...(devinNumber(planStatus, 16) !== undefined ? { overageBalanceMicros: devinNumber(planStatus, 16) } : {}),
	};
}

/**
 * Fetch the account's plan and quota state. The CLI calls `GetUserStatus` with
 * session-token metadata only (no user JWT), so this does the same.
 */
export async function getDevinUserStatus(
	token: string,
	signal: AbortSignal,
	fetchImpl: DevinFetch = fetch,
): Promise<DevinUserStatus> {
	const response = await devinUnary(DEVIN_USER_STATUS_PATH, field(1, devinMetadata(token)), signal, fetchImpl);
	return parseDevinUserStatus(response);
}
