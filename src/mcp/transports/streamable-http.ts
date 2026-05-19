// ─── Streamable HTTP Transport ──────────────────────────────────────────────
// Connects to a remote MCP server over HTTP with SSE (Server-Sent Events)
// for server→client streaming. Uses fetch for HTTP requests.

import type { Transport, TransportSendOptions } from "./transport.js";

const MAX_RESPONSE_BODY_BYTES = 10 * 1024 * 1024;

export class StreamableHttpTransport implements Transport {
  private url: string;
  private headers: Record<string, string>;
  private messageHandlers: Set<(raw: string) => void> = new Set();
  private notificationHandlers: Set<(method: string, params: unknown) => void> = new Set();
  private errorHandlers: Set<(err: Error) => void> = new Set();
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private connected = false;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.url = url.endsWith("/") ? url : url + "/";
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    };
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async send(message: string, options: TransportSendOptions = {}): Promise<void> {
    if (!this.connected) throw new Error("Not connected");

    const response = await fetch(this.url, {
      method: "POST",
      headers: this.buildRequestHeaders(),
      body: message,
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const sessionId = response.headers.get("Mcp-Session-Id");
    if (sessionId) this.sessionId = sessionId;

    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentType.toLowerCase().includes("text/event-stream")) {
      this.parseSseEventStream(await this.readResponseText(response));
      return;
    }

    const data: unknown = JSON.parse(await this.readResponseText(response));
    if (Array.isArray(data)) {
      for (const msg of data) {
        this.dispatchJsonRpcMessage(msg);
      }
    } else {
      this.dispatchJsonRpcMessage(data);
    }
  }

  private async readResponseText(response: Response): Promise<string> {
    const contentLength = response.headers.get("Content-Length");
    if (contentLength !== null) {
      const parsedLength = Number(contentLength);
      if (Number.isFinite(parsedLength) && parsedLength > MAX_RESPONSE_BODY_BYTES) {
        throw new Error(`MCP HTTP response body exceeded ${MAX_RESPONSE_BODY_BYTES} bytes`);
      }
    }

    if (!response.body) {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BODY_BYTES) {
        throw new Error(`MCP HTTP response body exceeded ${MAX_RESPONSE_BODY_BYTES} bytes`);
      }
      return text;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
          await reader.cancel();
          throw new Error(`MCP HTTP response body exceeded ${MAX_RESPONSE_BODY_BYTES} bytes`);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(body);
  }

  private buildRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.headers };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    if (this.protocolVersion) headers["MCP-Protocol-Version"] = this.protocolVersion;
    return headers;
  }

  private dispatchJsonRpcMessage(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const msg = data as {
      jsonrpc?: unknown;
      id?: unknown;
      method?: unknown;
      params?: unknown;
      result?: { protocolVersion?: unknown };
    };
    if (msg.jsonrpc !== "2.0") return;
    if (typeof msg.result?.protocolVersion === "string") {
      this.protocolVersion = msg.result.protocolVersion;
    }
    if (msg.id !== undefined) {
      for (const h of this.messageHandlers) h(JSON.stringify(data));
      return;
    }
    if (typeof msg.method === "string") {
      for (const h of this.notificationHandlers) h(msg.method, msg.params);
    }
  }

  private parseSseEventStream(stream: string): void {
    for (const frame of stream.split(/\r?\n\r?\n/)) {
      const dataLines: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line === "" || line.startsWith(":")) continue;
        if (line.startsWith("data:")) {
          const value = line.slice(5);
          dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
        }
      }
      if (dataLines.length === 0) continue;
      this.dispatchSseData(dataLines.join("\n"));
    }
  }

  private dispatchSseData(data: string): void {
    try {
      const parsed: unknown = JSON.parse(data);
      if (Array.isArray(parsed)) {
        for (const msg of parsed) {
          this.dispatchJsonRpcMessage(msg);
        }
        return;
      }
      this.dispatchJsonRpcMessage(parsed);
    } catch {
      // Ignore malformed SSE data frames.
    }
  }

  onMessage(handler: (raw: string) => void): void {
    this.messageHandlers.add(handler);
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandlers.add(handler);
  }

  onError(handler: (err: Error) => void): void {
    this.errorHandlers.add(handler);
  }

  async close(): Promise<void> {
    this.connected = false;
  }
}
