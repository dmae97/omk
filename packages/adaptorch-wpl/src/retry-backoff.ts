/**
 * Deterministic jitter retry backoff (W1).
 *
 * Produces a per-packet, per-attempt delay that is:
 *   - deterministic given (packet_id, retry_count): same inputs ⇒ same ms across
 *     processes and machines (no Math.random, no wall-clock dependence),
 *   - exponentially growing with retry_count, with the exponential BASE capped at `max`,
 *   - spread by a per-packet jitter factor derived from an FNV-1a hash of the packet id,
 *     so two packets retrying on the same schedule don't thunder-herd.
 *
 * FNV-1a 32-bit is implemented in-file (not imported across packages) so this module
 * stays zero-dependency and the determinism contract is fully localized here.
 */

/** Configuration for {@link backoffDelayMs}. All fields optional; see field defaults. */
export interface BackoffConfig {
	/**
	 * Base delay in ms for retry_count 0 (the seed of the exponential). Default 2000.
	 * If greater than {@link BackoffConfig.max}, it is clamped down to `max`.
	 */
	initial?: number;
	/** Upper bound in ms applied to the exponential base. Default 120000. */
	max?: number;
}

const FNV1A_OFFSET_BASIS = 0x811c9dc5;
const FNV1A_PRIME = 0x01000193;
const UINT32_MOD = 4294967296; // 2^32

/**
 * FNV-1a 32-bit hash over the UTF-16 code units of `s`. Returns an unsigned 32-bit integer
 * in [0, 2^32). Iterates per UTF-16 code unit (String.prototype.charCodeAt), matching the
 * spec contract exactly.
 */
export function fnv1a32(s: string): number {
	let hash = FNV1A_OFFSET_BASIS >>> 0;
	for (let i = 0; i < s.length; i++) {
		hash = Math.imul((hash ^ s.charCodeAt(i)) >>> 0, FNV1A_PRIME) >>> 0;
	}
	return hash >>> 0;
}

const DEFAULT_INITIAL_MS = 2000;
const DEFAULT_MAX_MS = 120000;

/**
 * Deterministic exponential backoff with per-packet jitter.
 *
 * Formula (authoritative — the test's hard-coded vectors are generated from this exact
 * expression by an independent reference script):
 *   n       = retryCount clamped to >= 0 (negative / NaN treated as 0)
 *   initial = cfg.initial ?? 2000;  if initial > max → initial = max
 *   max     = cfg.max ?? 120000
 *   base    = min(max, initial * 2**n)        // CAP APPLIES TO BASE, not to the result
 *   h       = fnv1a32(packetId)               // unsigned 32-bit
 *   jitter  = 0.5 + h / 2**32                 // ∈ [0.5, 1.5)
 *   return  = round(base * jitter)
 *
 * Range note: the literal expression `0.5 + h / 2**32` yields a jitter factor in [0.5, 1.5)
 * because h ∈ [0, 2**32). This is implemented exactly as specified; the returned delay may
 * therefore exceed `max` by up to ~50%. The spec comment "// range [0.5, 1.0)" is
 * inconsistent with the literal formula; the formula and its externally-generated vectors
 * are authoritative per the W1 task. See the W1 evidence note for details.
 */
export function backoffDelayMs(packetId: string, retryCount: number, cfg?: BackoffConfig): number {
	let n = retryCount;
	if (n < 0 || Number.isNaN(n)) {
		n = 0;
	}
	let initial = cfg?.initial ?? DEFAULT_INITIAL_MS;
	const max = cfg?.max ?? DEFAULT_MAX_MS;
	if (initial > max) {
		initial = max;
	}
	const base = Math.min(max, initial * 2 ** n);
	const h = fnv1a32(packetId);
	const jitter = 0.5 + h / UINT32_MOD;
	return Math.round(base * jitter);
}

/**
 * Computes the ISO-8601 "not-before" timestamp by adding `delayMs` milliseconds to `nowIso`.
 * If `nowIso` is not a parseable date, falls back to `Date.now()` so a corrupt stored
 * timestamp can never freeze a packet permanently.
 */
export function retryNotBefore(nowIso: string, delayMs: number): string {
	const parsed = Date.parse(nowIso);
	const t = Number.isNaN(parsed) ? Date.now() : parsed;
	return new Date(t + delayMs).toISOString();
}
