/**
 * Complete tool for structured subagent output.
 *
 * Subagents must call this tool to finish and return structured JSON output.
 */

import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { StringEnum } from "@oh-my-pi/pi-ai";
import type { Static, TObject } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { subprocessToolRegistry } from "$c/task/subprocess-tool-registry";
import type { ToolSession } from "./index";
import { jtdToJsonSchema } from "./jtd-to-json-schema";

export interface CompleteDetails {
	data: unknown;
	status: "success" | "aborted";
	error?: string;
}

const ajv = new Ajv({ allErrors: true, strict: false });

function normalizeSchema(schema: unknown): { normalized?: unknown; error?: string } {
	if (schema === undefined || schema === null) return {};
	if (typeof schema === "string") {
		try {
			return { normalized: JSON.parse(schema) };
		} catch (err) {
			return { error: err instanceof Error ? err.message : String(err) };
		}
	}
	return { normalized: schema };
}

function formatSchema(schema: unknown): string {
	if (schema === undefined) return "No schema provided.";
	if (typeof schema === "string") return schema;
	try {
		return JSON.stringify(schema, null, 2);
	} catch {
		return "[unserializable schema]";
	}
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
	if (!errors || errors.length === 0) return "Unknown schema validation error.";
	return errors
		.map((err) => {
			const path = err.instancePath ? `${err.instancePath}: ` : "";
			return `${path}${err.message ?? "invalid"}`;
		})
		.join("; ");
}

export class CompleteTool implements AgentTool<TObject, CompleteDetails> {
	public readonly name = "complete";
	public readonly label = "Complete";
	public readonly description =
		"Finish the task with structured JSON output. Call exactly once at the end of the task.\n\n" +
		"If you cannot complete the task, call with status='aborted' and an error message.";
	public readonly parameters: TObject;

	private readonly validate?: ValidateFunction;
	private readonly schemaError?: string;

	constructor(session: ToolSession) {
		const schemaResult = normalizeSchema(session.outputSchema);
		// Convert JTD to JSON Schema if needed (auto-detected)
		const normalizedSchema =
			schemaResult.normalized !== undefined ? jtdToJsonSchema(schemaResult.normalized) : undefined;
		let schemaError = schemaResult.error;

		if (normalizedSchema !== undefined && !schemaError) {
			try {
				this.validate = ajv.compile(normalizedSchema as any);
			} catch (err) {
				schemaError = err instanceof Error ? err.message : String(err);
			}
		}

		this.schemaError = schemaError;

		const schemaHint = formatSchema(normalizedSchema ?? session.outputSchema);

		// Use actual schema if provided, otherwise fall back to Type.Any
		// Merge description into the JSON schema for better tool documentation
		const dataSchema = normalizedSchema
			? Type.Unsafe({
					...(normalizedSchema as object),
					description: `Structured output matching the schema:\n${schemaHint}`,
				})
			: Type.Any({ description: "Structured JSON output (no schema specified)" });

		this.parameters = Type.Object({
			data: Type.Optional(dataSchema),
			status: Type.Optional(
				StringEnum(["success", "aborted"], {
					description: "Use 'aborted' if the task cannot be completed, defaults to 'success'",
				}),
			),
			error: Type.Optional(Type.String({ description: "Error message when status is 'aborted'" })),
		});
	}

	public async execute(
		_toolCallId: string,
		params: Static<TObject>,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<CompleteDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<CompleteDetails>> {
		const status = (params.status ?? "success") as "success" | "aborted";

		// Skip validation when aborting - data is optional for aborts
		if (status === "success") {
			if (params.data === undefined) {
				throw new Error("data is required when status is 'success'");
			}
			if (this.schemaError) {
				throw new Error(`Invalid output schema: ${this.schemaError}`);
			}
			if (this.validate && !this.validate(params.data)) {
				throw new Error(`Output does not match schema: ${formatAjvErrors(this.validate.errors)}`);
			}
		}

		const responseText =
			status === "aborted" ? `Task aborted: ${params.error || "No reason provided"}` : "Completion recorded.";

		return {
			content: [{ type: "text", text: responseText }],
			details: { data: params.data, status, error: params.error as string | undefined },
		};
	}
}

// Register subprocess tool handler for extraction + termination.
subprocessToolRegistry.register<CompleteDetails>("complete", {
	extractData: (event) => event.result?.details as CompleteDetails | undefined,
	shouldTerminate: () => true,
});
