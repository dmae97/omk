/**
 * Exa LinkedIn Tool
 *
 * Search LinkedIn for people, companies, and professional content.
 */
import { Type } from "@sinclair/typebox";
import type { CustomTool } from "../extensibility/custom-tools/types";
import { createExaTool } from "./factory";
import type { ExaRenderDetails } from "./types";

/** exa_linkedin - LinkedIn search */
export const linkedinTool: CustomTool<any, ExaRenderDetails> = createExaTool(
	"exa_linkedin",
	"Exa LinkedIn",
	`Search LinkedIn for people, companies, and professional content using Exa.

Returns LinkedIn search results with profiles, posts, and company information.

Parameters:
- query: LinkedIn search query (e.g., "Software Engineer at OpenAI", "Y Combinator companies")`,

	Type.Object({
		query: Type.String({ description: "LinkedIn search query" }),
	}),
	"linkedin_search_exa",
);
