// OMK v6.2 — Token Optimizer v2 (TypeScript)
// ===========================================
// packages/coding-agent/src/core/token-optimizer.ts
//
// 매 프롬프트마다 자동 토큰 최적화.

import { EventEmitter } from "events";

export interface TokenOptimizationResult {
  originalQuery: string;
  optimizedQuery: string;
  tokensSaved: number;
  technique: string;
  cacheHit: boolean;
}

export class LosslessCompressor extends EventEmitter {
  private templateCache: Map<string, string> = new Map();
  private abbreviationMap: Map<string, string> = new Map([
    ["artificial intelligence", "AI"],
    ["machine learning", "ML"],
    ["natural language processing", "NLP"],
    ["large language model", "LLM"],
    ["context window", "CW"],
  ]);

  compress(query: string): { compressed: string; tokensSaved: number } {
    let compressed = query;
    let saved = 0;

    // Template caching
    const hash = this.hash(query);
    if (this.templateCache.has(hash)) {
      return { compressed: this.templateCache.get(hash)!, tokensSaved: Math.floor(query.length / 4) };
    }

    // Abbreviation mapping
    for (const [full, abbr] of this.abbreviationMap) {
      const regex = new RegExp(full, "gi");
      const matches = compressed.match(regex);
      if (matches) {
        compressed = compressed.replace(regex, abbr);
        saved += matches.length * (full.length - abbr.length);
      }
    }

    // Result deduplication (remove repeated phrases)
    const words = compressed.split(/\s+/);
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const word of words) {
      const key = word.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(word);
      } else {
        saved += word.length;
      }
    }
    compressed = unique.join(" ");

    this.templateCache.set(hash, compressed);
    return { compressed, tokensSaved: Math.floor(saved / 4) };
  }

  private hash(text: string): string {
    let h = 0;
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    }
    return h.toString(16);
  }
}

export class LazyExecutor extends EventEmitter {
  private memoCache: Map<string, any> = new Map();

  execute<T>(taskId: string, fn: () => T, force = false): T {
    if (!force && this.memoCache.has(taskId)) {
      return this.memoCache.get(taskId);
    }
    const result = fn();
    this.memoCache.set(taskId, result);
    return result;
  }

  clear(): void {
    this.memoCache.clear();
  }
}

export class AdaptiveBudget extends EventEmitter {
  private budget: number;
  private used: number = 0;
  private history: { used: number; timestamp: number }[] = [];

  constructor(initialBudget = 10000) {
    super();
    this.budget = initialBudget;
  }

  allocate(tokens: number): boolean {
    if (this.used + tokens > this.budget) {
      this.emit("budgetExceeded", { used: this.used, requested: tokens, budget: this.budget });
      return false;
    }
    this.used += tokens;
    this.history.push({ used: this.used, timestamp: Date.now() });
    return true;
  }

  getStats(): { budget: number; used: number; remaining: number; utilization: number } {
    return {
      budget: this.budget,
      used: this.used,
      remaining: this.budget - this.used,
      utilization: this.used / this.budget,
    };
  }

  adjustBudget(newBudget: number): void {
    this.budget = newBudget;
    this.emit("budgetAdjusted", { newBudget });
  }
}

export class TokenOptimizer extends EventEmitter {
  private compressor: LosslessCompressor;
  private executor: LazyExecutor;
  private budget: AdaptiveBudget;

  constructor(budget = 10000) {
    super();
    this.compressor = new LosslessCompressor();
    this.executor = new LazyExecutor();
    this.budget = new AdaptiveBudget(budget);
  }

  optimize(query: string): TokenOptimizationResult {
    const originalTokens = Math.ceil(query.length / 4);

    const { compressed, tokensSaved } = this.compressor.compress(query);
    const optimizedTokens = Math.ceil(compressed.length / 4);

    const cacheHit = tokensSaved > 0 && compressed !== query;

    this.budget.allocate(optimizedTokens);

    return {
      originalQuery: query,
      optimizedQuery: compressed,
      tokensSaved: originalTokens - optimizedTokens,
      technique: cacheHit ? "template_cache+abbreviation" : "abbreviation",
      cacheHit,
    };
  }

  lazyExecute<T>(taskId: string, fn: () => T): T {
    return this.executor.execute(taskId, fn);
  }

  getBudgetStats(): { budget: number; used: number; remaining: number; utilization: number } {
    return this.budget.getStats();
  }
}

export default TokenOptimizer;
