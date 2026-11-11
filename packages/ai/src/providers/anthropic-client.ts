import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";

export type { Anthropic };

/**
 * Since 0.92.0 the SDK merges `ANTHROPIC_CUSTOM_HEADERS` into `defaultHeaders`, after its auth headers.
 * OMK reuses this client for Anthropic-compatible third-party endpoints, so an ambient value could reach
 * them or replace the selected `x-api-key`/`Authorization`. Keep only the headers OMK computed from
 * `model.headers` and `options.headers`, as before 0.92.0.
 */
export class OmkAnthropic extends Anthropic {
	constructor(options: ClientOptions) {
		super(options);
		this._options = { ...this._options, defaultHeaders: options.defaultHeaders };
	}
}
