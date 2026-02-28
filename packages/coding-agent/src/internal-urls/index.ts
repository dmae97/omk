/**
 * Internal URL routing system for internal protocols like agent://, memory://, skill://, and local://.
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

export * from "./agent-protocol";
export * from "./artifact-protocol";
export * from "./jobs-protocol";
export * from "./json-query";
export * from "./local-protocol";
export * from "./memory-protocol";
export * from "./pi-protocol";
export * from "./router";
export * from "./rule-protocol";
export * from "./skill-protocol";
export type * from "./types";
