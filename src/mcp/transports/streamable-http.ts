// ─── Streamable HTTP Transport ──────────────────────────────────────────────
// Connects to a remote MCP server over HTTP with SSE (Server-Sent Events)
// for server→client streaming. Uses fetch for HTTP requests.

import type { Transport, TransportSendOptions } from "./transport.js";

const MAX_RESPONSE_BODY_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 300_000;

function normalizeTimeoutMs(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? value : fallback;
}

export class StreamableHttpTransport implements Transport {
  private url: string;
  private headers: Record<string, string>;
  private messageHandlers: Set<(raw: string) => void> = new Set();
  private notificationHandlers: Set<(method: string, params: unknown) => void> = new Set();
  private errorHandlers: Set<(err: Error) => void> = new Set();
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private connected = false;
  private activeControllers: Set<AbortController> = new Set();
  private activeReaders: Set<ReadableStreamDefaultReader<Uint8Array>> = new Set();
  private closing = false;

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
    if (!this.connected || this.closing) throw new Error("Not connected");
    const timeoutMs = normalizeTimeoutMs(options.timeoutMs, FETCH_TIMEOUT_MS);
    const expectedResponseId = this.requestIdFromMessage(message);
    const requestController = new AbortController();
    this.activeControllers.add(requestController);

    const signal = options.signal
      ? AbortSignal.any([options.signal, requestController.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.any([requestController.signal, AbortSignal.timeout(timeoutMs)]);

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: this.buildRequestHeaders(),
        body: message,
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const sessionId = response.headers.get("Mcp-Session-Id");
      if (sessionId) this.sessionId = sessionId;

      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.toLowerCase().includes("text/event-stream")) {
        await this.readSseEventStream(response, timeoutMs, expectedResponseId);
        return;
      }

      const data: unknown = JSON.parse(await this.readResponseText(response, timeoutMs));
      if (Array.isArray(data)) {
        for (const msg of data) {
          this.dispatchJsonRpcMessage(msg);
        }
      } else {
        this.dispatchJsonRpcMessage(data);
      }
    } finally {
      requestController.abort();
      this.activeControllers.delete(requestController);
    }
  }

  private async readResponseText(response: Response, timeoutMs: number): Promise<string> {
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
    this.activeReaders.add(reader);
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await this.readChunkWithTimeout(reader, timeoutMs);
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
      this.activeReaders.delete(reader);
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

  private async readSseEventStream(
    response: Response,
    timeoutMs: number,
    expectedResponseId: string | number | undefined
  ): Promise<void> {
    if (!response.body) {
      this.parseSseEventStream(await response.text(), expectedResponseId);
      return;
    }

    const reader = response.body.getReader();
    this.activeReaders.add(reader);
    const decoder = new TextDecoder();
    let buffer = "";
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await this.readChunkWithTimeout(reader, timeoutMs);
        if (done) break;
        if (!value) continue;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BODY_BYTES) {
          await reader.cancel();
          throw new Error(`MCP HTTP response body exceeded ${MAX_RESPONSE_BODY_BYTES} bytes`);
        }
        buffer += decoder.decode(value, { stream: true });
        const dispatched = this.dispatchCompleteSseFrames(buffer, expectedResponseId);
        buffer = dispatched.remainder;
        if (dispatched.matchedExpectedResponse) {
          await reader.cancel();
          return;
        }
      }
      buffer += decoder.decode();
      this.parseSseEventStream(buffer, expectedResponseId);
    } finally {
      this.activeReaders.delete(reader);
      reader.releaseLock();
    }
  }

  private async readChunkWithTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs: number
  ) {
    return new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
      const timer = setTimeout(() => {
        reader.cancel().catch(() => {});
        reject(new Error(`MCP HTTP chunk read timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      reader.read().then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  }

  private buildRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.headers };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    if (this.protocolVersion) headers["MCP-Protocol-Version"] = this.protocolVersion;
    return headers;
  }

  private requestIdFromMessage(message: string): string | number | undefined {
    try {
      const parsed: unknown = JSON.parse(message);
      if (!parsed || typeof parsed !== "object") return undefined;
      const id = (parsed as { id?: unknown }).id;
      return typeof id === "string" || typeof id === "number" ? id : undefined;
    } catch {
      return undefined;
    }
  }

  private dispatchJsonRpcMessage(data: unknown, expectedResponseId?: string | number): boolean {
    if (!data || typeof data !== "object") return false;
    const msg = data as {
      jsonrpc?: unknown;
      id?: unknown;
      method?: unknown;
      params?: unknown;
      result?: { protocolVersion?: unknown };
    };
    if (msg.jsonrpc !== "2.0") return false;
    if (typeof msg.result?.protocolVersion === "string") {
      this.protocolVersion = msg.result.protocolVersion;
    }
    if (msg.id !== undefined) {
      for (const h of this.messageHandlers) h(JSON.stringify(data));
      return expectedResponseId !== undefined && msg.id === expectedResponseId;
    }
    if (typeof msg.method === "string") {
      for (const h of this.notificationHandlers) h(msg.method, msg.params);
    }
    return false;
  }

  private parseSseEventStream(stream: string, expectedResponseId?: string | number): boolean {
    const { remainder, matchedExpectedResponse } = this.dispatchCompleteSseFrames(stream, expectedResponseId);
    if (remainder.trim()) {
      return this.dispatchSseFrame(remainder, expectedResponseId) || matchedExpectedResponse;
    }
    return matchedExpectedResponse;
  }

  private dispatchCompleteSseFrames(
    stream: string,
    expectedResponseId?: string | number
  ): { remainder: string; matchedExpectedResponse: boolean } {
    let remaining = stream;
    let matchedExpectedResponse = false;
    while (true) {
      const match = /\r?\n\r?\n/.exec(remaining);
      if (!match) return { remainder: remaining, matchedExpectedResponse };
      const frame = remaining.slice(0, match.index);
      if (this.dispatchSseFrame(frame, expectedResponseId)) {
        matchedExpectedResponse = true;
      }
      remaining = remaining.slice(match.index + match[0].length);
    }
  }

  private dispatchSseFrame(frame: string, expectedResponseId?: string | number): boolean {
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line === "" || line.startsWith(":")) continue;
      if (line.startsWith("data:")) {
        const value = line.slice(5);
        dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
      }
    }
    if (dataLines.length === 0) return false;
    return this.dispatchSseData(dataLines.join("\n"), expectedResponseId);
  }

  private dispatchSseData(data: string, expectedResponseId?: string | number): boolean {
    try {
      const parsed: unknown = JSON.parse(data);
      if (Array.isArray(parsed)) {
        let matchedExpectedResponse = false;
        for (const msg of parsed) {
          if (this.dispatchJsonRpcMessage(msg, expectedResponseId)) {
            matchedExpectedResponse = true;
          }
        }
        return matchedExpectedResponse;
      }
      return this.dispatchJsonRpcMessage(parsed, expectedResponseId);
    } catch {
      // Ignore malformed SSE data frames.
      return false;
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
    this.closing = true;
    this.connected = false;
    for (const controller of this.activeControllers) {
      controller.abort();
    }
    this.activeControllers.clear();
    await Promise.all(
      [...this.activeReaders].map((reader) => reader.cancel().catch(() => {}))
    );
    this.activeReaders.clear();
    this.sessionId = null;
    this.protocolVersion = null;
  }
}
