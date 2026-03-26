import { describe, expect, it } from "bun:test";
import { type PendingExtensionRequest, requestRpcEditor } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-mode";
import type { RpcExtensionUIRequest } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-types";

function isExtensionUiRequest(obj: RpcExtensionUIRequest | object): obj is RpcExtensionUIRequest {
	return "type" in obj && obj.type === "extension_ui_request";
}

describe("requestRpcEditor", () => {
	it("serializes promptStyle on editor requests", async () => {
		const pendingRequests = new Map<string, PendingExtensionRequest>();
		const requests: RpcExtensionUIRequest[] = [];

		const promise = requestRpcEditor(
			pendingRequests,
			obj => {
				if (isExtensionUiRequest(obj)) {
					requests.push(obj);
				}
			},
			"Enter your response:",
			"draft",
			undefined,
			{ promptStyle: true },
		);

		expect(requests).toHaveLength(1);
		const request = requests[0];
		if (!request || request.method !== "editor") {
			throw new Error("Expected an editor request");
		}
		expect(request.promptStyle).toBe(true);
		expect(request.prefill).toBe("draft");

		const pending = pendingRequests.get(request.id);
		if (!pending) {
			throw new Error("Expected a pending request");
		}
		pending.resolve({ type: "extension_ui_response", id: request.id, value: "custom response" });

		await expect(promise).resolves.toBe("custom response");
		expect(pendingRequests.size).toBe(0);
	});

	it("resolves editor requests on abort and clears pending state", async () => {
		const pendingRequests = new Map<string, PendingExtensionRequest>();
		const requests: RpcExtensionUIRequest[] = [];
		const controller = new AbortController();

		const promise = requestRpcEditor(
			pendingRequests,
			obj => {
				if (isExtensionUiRequest(obj)) {
					requests.push(obj);
				}
			},
			"Enter your response:",
			undefined,
			{ signal: controller.signal },
			{ promptStyle: true },
		);

		expect(requests).toHaveLength(1);
		const request = requests[0];
		if (!request || request.method !== "editor") {
			throw new Error("Expected an editor request");
		}
		expect(request.promptStyle).toBe(true);
		expect(pendingRequests.has(request.id)).toBe(true);

		controller.abort();

		expect(requests).toHaveLength(2);
		const cancelRequest = requests[1];
		if (!cancelRequest || cancelRequest.method !== "cancel") {
			throw new Error("Expected a cancel request");
		}
		expect(cancelRequest.targetId).toBe(request.id);
		await expect(promise).resolves.toBeUndefined();
		expect(pendingRequests.has(request.id)).toBe(false);
	});
});
