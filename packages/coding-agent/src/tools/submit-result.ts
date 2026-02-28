/**
 * Submit result tool for structured subagent output.
 *
 * Subagents must call this tool to finish and return structured JSON output.
 */
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { sanitizeSchemaForStrictMode } from "@oh-my-pi/pi-ai/utils/schema";
import type { Static, TSchema } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { subprocessToolRegistry } from "../task/subprocess-tool-registry";
import type { ToolSession } from ".";
import { jtdToJsonSchema } from "./jtd-to-json-schema";

export interface SubmitResultDetails {
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
		.map(err => {
			const path = err.instancePath ? `${err.instancePath}: ` : "";
			return `${path}${err.message ?? "invalid"}`;
		})
		.join("; ");
}

/**
 * Resolve all $ref references in a JSON Schema by inlining definitions.
 * Handles $defs and definitions at any nesting level.
 * Removes $defs/definitions from the output since all refs are inlined.
 */
function resolveSchemaRefs(schema: Record<string, unknown>): Record<string, unknown> {
	const defs: Record<string, Record<string, unknown>> = {};
	const defsObj = schema.$defs ?? schema.definitions;
	if (defsObj && typeof defsObj === "object" && !Array.isArray(defsObj)) {
		for (const [name, def] of Object.entries(defsObj as Record<string, unknown>)) {
			if (def && typeof def === "object" && !Array.isArray(def)) {
				defs[name] = def as Record<string, unknown>;
			}
		}
	}
	if (Object.keys(defs).length === 0) return schema;

	const inlining = new Set<string>();
	function inline(node: unknown): unknown {
		if (node === null || typeof node !== "object") return node;
		if (Array.isArray(node)) return node.map(inline);
		const obj = node as Record<string, unknown>;
		const ref = obj.$ref;
		if (typeof ref === "string") {
			const match = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
			if (match) {
				const name = match[1];
				const def = defs[name];
				if (def) {
					if (inlining.has(name)) return {};
					inlining.add(name);
					const resolved = inline(def);
					inlining.delete(name);
					return resolved;
				}
			}
		}
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			if (key === "$defs" || key === "definitions") continue;
			result[key] = inline(value);
		}
		return result;
	}
	return inline(schema) as Record<string, unknown>;
}

export class SubmitResultTool implements AgentTool<TSchema, SubmitResultDetails> {
	readonly name = "submit_result";
	readonly label = "Submit Result";
	readonly description =
		"Finish the task with structured JSON output. Call exactly once at the end of the task.\n\n" +
		"If you cannot complete the task, call with an error message payload.";
	readonly parameters: TSchema;
	strict = true;
	lenientArgValidation = true;

	readonly #validate?: ValidateFunction;
	#schemaValidationFailures = 0;

	constructor(session: ToolSession) {
		const createParameters = (dataSchema: TSchema): TSchema =>
			Type.Object(
				{
					result: Type.Union([
						Type.Object({ data: dataSchema }, { description: "Successfully completed the task" }),
						Type.Object({
							error: Type.String({ description: "Error message when the task cannot be completed" }),
						}),
					]),
				},
				{
					additionalProperties: false,
					description: "Submit either `data` for success or `error` for failure",
				},
			) as TSchema;

		let validate: ValidateFunction | undefined;
		let dataSchema: TSchema;
		let parameters: TSchema;
		let strict = true;

		try {
			const schemaResult = normalizeSchema(session.outputSchema);
			// Convert JTD to JSON Schema if needed (auto-detected)
			const normalizedSchema =
				schemaResult.normalized !== undefined ? jtdToJsonSchema(schemaResult.normalized) : undefined;
			let schemaError = schemaResult.error;

			if (!schemaError && normalizedSchema === false) {
				schemaError = "boolean false schema rejects all outputs";
			}

			if (normalizedSchema !== undefined && normalizedSchema !== false && !schemaError) {
				try {
					validate = ajv.compile(normalizedSchema as Record<string, unknown> | boolean);
				} catch (err) {
					schemaError = err instanceof Error ? err.message : String(err);
				}
			}

			const schemaHint = formatSchema(normalizedSchema ?? session.outputSchema);
			const schemaDescription = schemaError
				? `Structured JSON output (output schema invalid; accepting unconstrained object): ${schemaError}`
				: `Structured output matching the schema:\n${schemaHint}`;
			const sanitizedSchema =
				!schemaError &&
				normalizedSchema != null &&
				typeof normalizedSchema === "object" &&
				!Array.isArray(normalizedSchema)
					? sanitizeSchemaForStrictMode(normalizedSchema as Record<string, unknown>)
					: !schemaError && normalizedSchema === true
						? {}
						: undefined;

			if (sanitizedSchema !== undefined) {
				const resolved = resolveSchemaRefs({
					...sanitizedSchema,
					description: schemaDescription,
				});
				dataSchema = Type.Unsafe(resolved);
			} else {
				dataSchema = Type.Record(Type.String(), Type.Any(), {
					description: schemaError ? schemaDescription : "Structured JSON output (no schema specified)",
				});
			}
			parameters = createParameters(dataSchema);
			JSON.stringify(parameters);
			// Verify the final parameters compile with AJV (catches unresolved $ref, etc.)
			ajv.compile(parameters as Record<string, unknown>);
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			dataSchema = Type.Record(Type.String(), Type.Any(), {
				description: `Structured JSON output (schema processing failed: ${errorMsg})`,
			});
			parameters = createParameters(dataSchema);
			validate = undefined;
			strict = false;
		}

		this.#validate = validate;
		this.parameters = parameters;
		this.strict = strict;
	}

	async execute(
		_toolCallId: string,
		params: Static<TSchema>,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<SubmitResultDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<SubmitResultDetails>> {
		const raw = params as Record<string, unknown>;
		const rawResult = raw.result;
		if (!rawResult || typeof rawResult !== "object" || Array.isArray(rawResult)) {
			throw new Error("result must be an object containing either data or error");
		}

		const resultRecord = rawResult as Record<string, unknown>;
		const errorMessage = typeof resultRecord.error === "string" ? resultRecord.error : undefined;
		const data = resultRecord.data;

		if (errorMessage !== undefined && data !== undefined) {
			throw new Error("result cannot contain both data and error");
		}
		if (errorMessage === undefined && data === undefined) {
			throw new Error("result must contain either data or error");
		}

		const status = errorMessage !== undefined ? "aborted" : "success";
		let schemaValidationOverridden = false;
		if (status === "success") {
			if (data === undefined || data === null) {
				throw new Error("data is required when submit_result indicates success");
			}
			if (this.#validate && !this.#validate(data)) {
				this.#schemaValidationFailures++;
				if (this.#schemaValidationFailures <= 1) {
					throw new Error(`Output does not match schema: ${formatAjvErrors(this.#validate.errors)}`);
				}
				schemaValidationOverridden = true;
			}
		}

		const responseText =
			status === "aborted"
				? `Task aborted: ${errorMessage}`
				: schemaValidationOverridden
					? `Result submitted (schema validation overridden after ${this.#schemaValidationFailures} failed attempt(s)).`
					: "Result submitted.";
		return {
			content: [{ type: "text", text: responseText }],
			details: { data, status, error: errorMessage },
		};
	}
}

// Register subprocess tool handler for extraction + termination.
subprocessToolRegistry.register<SubmitResultDetails>("submit_result", {
	extractData: event => {
		const details = event.result?.details;
		if (!details || typeof details !== "object") return undefined;
		const record = details as Record<string, unknown>;
		const status = record.status;
		if (status !== "success" && status !== "aborted") return undefined;
		return {
			data: record.data,
			status,
			error: typeof record.error === "string" ? record.error : undefined,
		};
	},
	shouldTerminate: event => !event.isError,
});
