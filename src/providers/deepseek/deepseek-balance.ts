export interface DeepSeekBalanceInfo {
  currency: "CNY" | "USD" | string;
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

export interface DeepSeekBalanceResponse {
  is_available: boolean;
  balance_infos: DeepSeekBalanceInfo[];
}

export interface DeepSeekAvailabilityCheck {
  provider: "deepseek";
  available: boolean;
  checkedAt: number;
  reason?: string;
  disableForRun: boolean;
  balance?: DeepSeekBalanceResponse;
}

export interface CheckDeepSeekBalanceOptions {
  apiKey?: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export async function checkDeepSeekBalance(
  options: CheckDeepSeekBalanceOptions = {}
): Promise<DeepSeekAvailabilityCheck> {
  const checkedAt = Date.now();
  const env = options.env ?? process.env;
  const apiKeyEnv = options.apiKeyEnv ?? "DEEPSEEK_API_KEY";
  const apiKey = options.apiKey ?? env[apiKeyEnv];
  if (!apiKey) {
    return unavailable(checkedAt, `${apiKeyEnv} is not set`, true);
  }

  const baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  timeout.unref?.();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetchImpl(`${baseUrl}/user/balance`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal,
    });
    if (!response.ok) {
      const reason = deepseekStatusReason(response.status);
      return unavailable(checkedAt, reason, true);
    }

    const payload = await response.json() as Partial<DeepSeekBalanceResponse>;
    const balance: DeepSeekBalanceResponse = {
      is_available: Boolean(payload.is_available),
      balance_infos: Array.isArray(payload.balance_infos) ? payload.balance_infos as DeepSeekBalanceInfo[] : [],
    };
    return {
      provider: "deepseek",
      available: balance.is_available,
      checkedAt,
      reason: balance.is_available ? undefined : "DeepSeek balance is unavailable for API calls",
      disableForRun: !balance.is_available,
      balance,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return unavailable(checkedAt, `DeepSeek balance preflight failed: ${reason}`, true);
  } finally {
    clearTimeout(timeout);
  }
}

export function deepseekStatusReason(status: number): string {
  switch (status) {
    case 400:
      return "DeepSeek invalid request format";
    case 401:
      return "DeepSeek authentication failed";
    case 402:
      return "DeepSeek 402 insufficient balance";
    case 422:
      return "DeepSeek invalid request parameters";
    case 429:
      return "DeepSeek rate limit reached";
    case 500:
      return "DeepSeek server error";
    case 503:
      return "DeepSeek server overloaded";
    default:
      return `DeepSeek balance preflight failed with HTTP ${status}`;
  }
}

function unavailable(
  checkedAt: number,
  reason: string,
  disableForRun: boolean
): DeepSeekAvailabilityCheck {
  return {
    provider: "deepseek",
    available: false,
    checkedAt,
    reason,
    disableForRun,
  };
}
