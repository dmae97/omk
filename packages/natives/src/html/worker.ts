/**
 * Worker for HTML to Markdown conversion.
 * Uses WASM for actual conversion.
 */

import { html_to_markdown } from "../../wasm/pi_natives";
import type { HtmlRequest, HtmlResponse } from "./types";

declare const self: Worker;

function respond(msg: HtmlResponse): void {
	self.postMessage(msg);
}

self.addEventListener("message", (e: MessageEvent<HtmlRequest>) => {
	const msg = e.data;

	switch (msg.type) {
		case "init":
			respond({ type: "ready", id: msg.id });
			break;

		case "destroy":
			break;

		case "convert": {
			try {
				const markdown = html_to_markdown(msg.html, msg.options);
				respond({ type: "converted", id: msg.id, markdown });
			} catch (err) {
				respond({
					type: "error",
					id: msg.id,
					error: err instanceof Error ? err.message : String(err),
				});
			}
			break;
		}
	}
});
