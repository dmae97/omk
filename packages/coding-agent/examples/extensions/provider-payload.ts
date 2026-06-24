import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "open-multi-agent-kit";

export default function (omk: ExtensionAPI) {
	const logFile = join(process.cwd(), ".omk", "provider-payload.log");

	omk.on("before_provider_request", (event) => {
		appendFileSync(logFile, `${JSON.stringify(event.payload, null, 2)}\n\n`, "utf8");

		// Optional: replace the payload instead of only logging it.
		// return { ...event.payload, temperature: 0 };
	});

	omk.on("after_provider_response", (event) => {
		appendFileSync(logFile, `[${event.status}] ${JSON.stringify(event.headers)}\n\n`, "utf8");
	});
}
