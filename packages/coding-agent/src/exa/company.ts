/**
 * Exa Company Tool
 *
 * Research companies using Exa's comprehensive data sources.
 */
import { Type } from "@sinclair/typebox";
import type { CustomTool } from "../extensibility/custom-tools/types";
import { createExaTool } from "./factory";
import type { ExaRenderDetails } from "./types";

/** exa_company - Company research */
export const companyTool: CustomTool<any, ExaRenderDetails> = createExaTool(
	"exa_company",
	"Exa Company",
	`Research companies using Exa's comprehensive data sources.

Returns detailed company information including overview, news, financials, and key people.

Parameters:
- company_name: Name of the company to research (e.g., "OpenAI", "Google", "Y Combinator")`,

	Type.Object({
		company_name: Type.String({ description: "Name of the company to research" }),
	}),
	"company_research_exa",
);
