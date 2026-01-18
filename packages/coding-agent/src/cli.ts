#!/usr/bin/env bun
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
import { APP_NAME } from "./config";
import { main } from "./main";

process.title = APP_NAME;
main(process.argv.slice(2));
