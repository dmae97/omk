/**
 * Compiled-binary registration for the bundled `open-multi-agent-kit` namespace.
 *
 * `loader.ts` cannot import `../index.ts` directly — that edge put it inside the
 * index↔core import cycle (scripts/check-import-cycles.mjs). The binary entry
 * (src/bun/cli.ts) loads this module before any extension resolves, so the
 * virtual-module table still sees the full namespace exactly as before.
 */

import { registerBundledCodingAgentNamespace } from "../core/extensions/bundled-virtual-modules.ts";
import * as bundledCodingAgent from "../index.ts";

registerBundledCodingAgentNamespace(bundledCodingAgent);
