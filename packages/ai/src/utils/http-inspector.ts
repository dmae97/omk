import * as os from "node:os";
import * as path from "node:path";

export type RawHttpRequestDump = {
	provider: string;
	api: string;
	model: string;
	method?: string;
	url?: string;
	headers?: Record<string, string>;
	body?: unknown;
};

type ErrorWithStatus = {
	status?: unknown;
	statusCode?: unknown;
	response?: { status?: unknown };
	cause?: unknown;
};

const SENSITIVE_HEADERS = ["authorization", "x-api-key", "api-key", "cookie", "set-cookie", "proxy-authorization"];

export async function appendRawHttpRequestDumpFor400(
	message: string,
	error: unknown,
	dump: RawHttpRequestDump | undefined,
): Promise<string> {
	if (!dump || getStatusCode(error) !== 400) {
		return message;
	}

	const sanitizedDump = sanitizeDump(dump);
	const fileName = `${Date.now()}-${Bun.hash(JSON.stringify(sanitizedDump)).toString(36)}.json`;
	const filePath = path.join(os.homedir(), ".omp", "logs", "http-400-requests", fileName);

	try {
		await Bun.write(filePath, `${JSON.stringify(sanitizedDump, null, 2)}\n`);
		return `${message}\nraw-http-request=${filePath}`;
	} catch (writeError) {
		const writeMessage = writeError instanceof Error ? writeError.message : String(writeError);
		return `${message}\nraw-http-request-save-failed=${writeMessage}`;
	}
}

export function withHttpStatus(error: unknown, status: number): Error {
	const wrapped = error instanceof Error ? error : new Error(String(error));
	(wrapped as ErrorWithStatus).status = status;
	return wrapped;
}

function getStatusCode(error: unknown): number | undefined {
	if (!error || typeof error !== "object") {
		return undefined;
	}

	const typedError = error as ErrorWithStatus;
	const directStatus = toStatusCode(typedError.status) ?? toStatusCode(typedError.statusCode);
	if (directStatus !== undefined) {
		return directStatus;
	}

	const responseStatus = toStatusCode(typedError.response?.status);
	if (responseStatus !== undefined) {
		return responseStatus;
	}

	if (typedError.cause) {
		return getStatusCode(typedError.cause);
	}

	return undefined;
}

function toStatusCode(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return undefined;
}

function sanitizeDump(dump: RawHttpRequestDump): RawHttpRequestDump {
	return {
		...dump,
		headers: redactHeaders(dump.headers),
	};
}

function redactHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
	if (!headers) {
		return undefined;
	}

	const redacted: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
			redacted[key] = "[redacted]";
			continue;
		}
		redacted[key] = value;
	}
	return redacted;
}
