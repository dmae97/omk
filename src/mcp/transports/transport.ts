// ─── Transport Interface ────────────────────────────────────────────────────
// Common interface for MCP transport implementations.

export interface TransportSendOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface Transport {
  /** Connect to the transport (spawn process, open socket, etc.) */
  connect(): Promise<void>;

  /** Send a raw message string */
  send(message: string, options?: TransportSendOptions): Promise<void>;

  /** Register handler for incoming JSON-RPC messages */
  onMessage(handler: (raw: string) => void): void;

  /** Register handler for incoming JSON-RPC notifications */
  onNotification(handler: (method: string, params: unknown) => void): void;

  /** Register handler for transport errors */
  onError(handler: (err: Error) => void): void;

  /** Process ID, if the transport uses a local child process */
  pid?: number;

  /** Close the transport connection */
  close?(): Promise<void>;
}
