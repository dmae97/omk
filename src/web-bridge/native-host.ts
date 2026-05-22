import { stdin, stdout } from "process";
import { WEB_BRIDGE_MAX_PAYLOAD_BYTES } from "../contracts/web-bridge.js";
import { handleWebBridgeRequest } from "./host.js";

export async function runWebBridgeNativeHost(): Promise<void> {
  await runNativeMessagingLoop(process.stdin, process.stdout);
}

export async function runNativeMessagingLoop(input = stdin, output = stdout): Promise<void> {
  let buffer = Buffer.alloc(0);
  input.on("data", async (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > WEB_BRIDGE_MAX_PAYLOAD_BYTES) {
        buffer = Buffer.alloc(0);
        writeNativeMessage(output, { schemaVersion: 1, requestId: "unknown", ok: false, error: { code: "payload_too_large", message: "Native message payload is too large" } });
        return;
      }
      if (buffer.length < 4 + length) return;
      const payload = buffer.subarray(4, 4 + length).toString("utf-8");
      buffer = buffer.subarray(4 + length);
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch (err) {
        writeNativeMessage(output, { schemaVersion: 1, requestId: "unknown", ok: false, error: { code: "invalid_schema", message: err instanceof Error ? err.message : String(err) } });
        continue;
      }
      writeNativeMessage(output, await handleWebBridgeRequest(parsed));
    }
  });
  await new Promise<void>((resolve) => input.on("end", resolve));
}

function writeNativeMessage(output: NodeJS.WritableStream, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  output.write(Buffer.concat([header, body]));
}
