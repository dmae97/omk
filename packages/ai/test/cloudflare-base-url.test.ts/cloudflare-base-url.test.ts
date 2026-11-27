import { afterEach, describe, expect, it, vi } from "vitest";
import { isCloudflareProvider, resolveCloudflareBaseUrl } from "../src/providers/cloudflare.ts";
import type { Api, Model } from "../src/types.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

function model(baseUrl: string, provider = "cloudflare-ai-gateway"): Model<Api> {
  return {
    id: "test-model",
    name: "test-model",
    api: "openai-completions",
    provider,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 4096,
    maxTokens: 1024,
  };
}

describe("isCloudflareProvider", () => {
  it("returns true for cloudflare-workers-ai", () => {
    expect(isCloudflareProvider("cloudflare-workers-ai")).toBe(true);
  });

  it("returns true for cloudflare-ai-gateway", () => {
    expect(isCloudflareProvider("cloudflare-ai-gateway")).toBe(true);
  });

  it("returns false for cloudflare", () => {
    expect(isCloudflareProvider("cloudflare")).toBe(false);
  });

  it("returns false for openai", () => {
    expect(isCloudflareProvider("openai")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(isCloudflareProvider("Cloudflare-Workers-AI")).toBe(false);
  });
});

describe("resolveCloudflareBaseUrl", () => {
  it("returns a URL without placeholders unchanged", () => {
    expect(resolveCloudflareBaseUrl(model("https://api.example.com/v1"))).toBe(
      "https://api.example.com/v1",
    );
  });

  it("substitutes CLOUDFLARE_ACCOUNT_ID", () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acc123");
    expect(
      resolveCloudflareBaseUrl(
        model("https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1"),
      ),
    ).toBe("https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1");
  });

  it("substitutes CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_GATEWAY_ID", () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acc123");
    vi.stubEnv("CLOUDFLARE_GATEWAY_ID", "gw");
    expect(
      resolveCloudflareBaseUrl(
        model(
          "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
        ),
      ),
    ).toBe("https://gateway.ai.cloudflare.com/v1/acc123/gw/compat");
  });

  it("throws when CLOUDFLARE_ACCOUNT_ID is unset", () => {
    expect(() =>
      resolveCloudflareBaseUrl(
        model("https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1"),
      ),
    ).toThrow(
      "CLOUDFLARE_ACCOUNT_ID is required for provider cloudflare-ai-gateway but is not set.",
    );
  });

  it("throws when CLOUDFLARE_GATEWAY_ID is unset", () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acc123");
    expect(() =>
      resolveCloudflareBaseUrl(
        model(
          "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
        ),
      ),
    ).toThrow(
      "CLOUDFLARE_GATEWAY_ID is required for provider cloudflare-ai-gateway but is not set.",
    );
  });

  it("throws when CLOUDFLARE_GATEWAY_ID is empty", () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acc123");
    vi.stubEnv("CLOUDFLARE_GATEWAY_ID", "");
    expect(() =>
      resolveCloudflareBaseUrl(
        model(
          "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
        ),
      ),
    ).toThrow(
      "CLOUDFLARE_GATEWAY_ID is required for provider cloudflare-ai-gateway but is not set.",
    );
  });

  it("leaves a lowercase placeholder unchanged", () => {
    expect(resolveCloudflareBaseUrl(model("https://x/{lower}/y"))).toBe("https://x/{lower}/y");
  });
});
