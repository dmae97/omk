/**
 * Internal URL routing system for internal protocols like agent://, memory://, and skill://.
 *
 * This module provides a unified way to resolve internal URLs without
 * exposing filesystem paths to the agent.
 *
 * @example
 * ```ts
 * import { InternalUrlRouter, AgentProtocolHandler, MemoryProtocolHandler, SkillProtocolHandler } from './internal-urls';
 *
 * const router = new InternalUrlRouter();
 * router.register(new AgentProtocolHandler({ getArtifactsDir: () => sessionDir }));
 * router.register(new MemoryProtocolHandler({ getMemoryRoot: () => memoryRoot }));
 * router.register(new SkillProtocolHandler({ getSkills: () => skills }));
 *
 * if (router.canHandle('agent://reviewer_0')) {
 *   const resource = await router.resolve('agent://reviewer_0');
 *   console.log(resource.content);
 * }
 * ```
 */

export { AgentProtocolHandler, type AgentProtocolOptions } from "./agent-protocol";
export { ArtifactProtocolHandler, type ArtifactProtocolOptions } from "./artifact-protocol";
export { applyQuery, parseQuery, pathToQuery } from "./json-query";
export { MemoryProtocolHandler, type MemoryProtocolOptions, resolveMemoryUrlToPath } from "./memory-protocol";
export { PlanProtocolHandler, type PlanProtocolOptions, resolvePlanUrlToPath } from "./plan-protocol";
export { InternalUrlRouter } from "./router";
export { RuleProtocolHandler, type RuleProtocolOptions } from "./rule-protocol";
export { SkillProtocolHandler, type SkillProtocolOptions } from "./skill-protocol";
export type { InternalResource, InternalUrl, ProtocolHandler } from "./types";
