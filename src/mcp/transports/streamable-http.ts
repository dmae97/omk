// ─── Streamable HTTP Transport ──────────────────────────────────────────────
// Connects to a remote MCP server over HTTP with SSE (Server-Sent Events)
// for server→client streaming. Uses fetch for HTTP requests.

import type { Transport } from "./transport.js";

export class StreamableHttpTransport implements Transport {
  private url: string;
  private headers: Record<string, string>;
  private messageHandlers: Set<(raw: string) => void> = new Set();
  private notificationHandlers: Set<(method: string, params: unknown) => void> = new Set();
  private errorHandlers: Set<(err: Error) => void> = new Set();
  private eventSource: EventSource | null = null;
  private sessionId: string | null = null;

  constructor(url: string, headers: Record<string, string> = {}) {
    this.url = url.endsWith("/") ? url : url + "/";
    this.headers = { "Content-Type": "application/json", ...headers };
  }

  async connect(): Promise<void> {
    // Initialize via HTTP POST
    const initResponse = await fetch(this.url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "omk-mcp-host", version: "0.0.0" },
        },
      }),
    });

    if (!initResponse.ok) {
      const err = new Error(`HTTP ${initResponse.status}: ${initResponse.statusText}`);
      for (const h of this.errorHandlers) h(err);
      throw err;
    }

    const initData = (await initResponse.json()) as { result?: { sessionId?: string }; error?: { message?: string } };
    if (initData.error) {
      const err = new Error(initData.error.message ?? "Initialize failed");
      for (const h of this.errorHandlers) h(err);
      throw err;
    }

    this.sessionId = initData.result?.sessionId ?? null;

    // Set up SSE for server→client streaming
    const sseUrl = this.url + "sse" + (this.sessionId ? `?sessionId=${this.sessionId}` : "");
    this.eventSource = new EventSource(sseUrl);

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.jsonrpc === "2.0") {
          if (data.id !== undefined && data.id !== 0) {
            for (const h of this.messageHandlers) h(JSON.stringify(data));
          } else {
            for (const h of this.notificationHandlers) h(data.method, data.params);
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    this.eventSource.onerror = () => {
      const err = new Error("SSE connection lost");
      for (const h of this.errorHandlers) h(err);
    };
  }

  async send(message: string): Promise<void> {
    if (!this.url) throw new Error("Not connected");

    const response = await fetch(this.url, {
      method: "POST",
      headers: this.headers,
      body: message,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Parse the response and deliver to message handlers
    try {
      const data = await response.json();
      if (Array.isArray(data)) {
        for (const msg of data) {
          for (const h of this.messageHandlers) h(JSON.stringify(msg));
        }
      } else {
        for (const h of this.messageHandlers) h(JSON.stringify(data));
      }
    } catch {
      // Response already handled via SSE
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
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}