/**
 * One-shot freedom-mode banner.
 *
 * The interactive session calls `bannerOnce(cfg, memo)` once at startup. The
 * memo is a session-scoped object that this module mutates so the same banner
 * is never rendered twice in the same session. The memo lives wherever the
 * session does; that keeps the banner module pure and testable.
 */
import type { FreedomConfig } from "./config.ts";

export interface BannerMemo {
	shown?: boolean;
}

const BANNER_TEMPLATE = `
╔══════════════════════════════════════════════════════════╗
║            OMK FREEDOM MODE — ACTIVE                    ║
║                                                          ║
║   approval_policy = yolo                                 ║
║   safety floor    = enforced (secrets / privilege /      ║
║                                fs / scope)               ║
║                                                          ║
║   > User autonomy. Bounded execution. No moralizing.     ║
╚══════════════════════════════════════════════════════════╝
`;

export function bannerOnce(cfg: FreedomConfig, memo: BannerMemo): string | undefined {
	if (!cfg.enabled) return undefined;
	if (!cfg.banner.show) return undefined;
	if (memo.shown) return undefined;
	memo.shown = true;
	return BANNER_TEMPLATE;
}
