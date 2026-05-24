export function stripAnsi(value: string): string {
  return value
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

export interface ContinuePromptGuardOptions {
  maxAutoEnters?: number;
  cooldownMs?: number;
  now?: () => number;
}

const SAFE_CONTINUE_PROMPT_PATTERNS = [
  /press\s+(?:enter|return)\s+to\s+continue\.{0,3}/i,
  /press\s+any\s+key\s+to\s+continue\.{0,3}/i,
  /hit\s+(?:enter|return)\s+to\s+continue\.{0,3}/i,
  /계속하려면\s*(?:enter|엔터)/i,
];

const UNSAFE_PROMPT_PATTERNS = [
  /approve/i,
  /permission/i,
  /allow/i,
  /confirm/i,
  /delete/i,
  /overwrite/i,
  /publish/i,
  /deploy/i,
  /execute/i,
  /run command/i,
  /proceed\?/i,
  /y\/n/i,
  /\[y\/n\]/i,
];

export class KimiContinuePromptGuard {
  private readonly maxAutoEnters: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private tail = "";
  private autoEnterCount = 0;
  private lastEnterAt = 0;

  constructor(options: ContinuePromptGuardOptions = {}) {
    this.maxAutoEnters = options.maxAutoEnters ?? 5;
    this.cooldownMs = options.cooldownMs ?? 750;
    this.now = options.now ?? (() => Date.now());
  }

  process(chunk: string): { sendEnter: boolean; reason?: string; exceeded?: boolean } {
    this.tail += chunk;
    this.tail = stripAnsi(this.tail);
    if (this.tail.length > 4096) {
      this.tail = this.tail.slice(-4096);
    }

    if (this.autoEnterCount >= this.maxAutoEnters) {
      return {
        exceeded: true,
        reason: `Kimi continue prompt exceeded maxAutoEnter=${this.maxAutoEnters}`,
        sendEnter: false,
      };
    }

    if (this.now() - this.lastEnterAt < this.cooldownMs) {
      return { sendEnter: false };
    }

    for (const pattern of UNSAFE_PROMPT_PATTERNS) {
      if (pattern.test(this.tail)) {
        return { sendEnter: false };
      }
    }

    for (const pattern of SAFE_CONTINUE_PROMPT_PATTERNS) {
      if (pattern.test(this.tail)) {
        this.autoEnterCount++;
        this.lastEnterAt = this.now();
        this.tail = "";
        return { sendEnter: true, reason: "safe Kimi continue prompt detected" };
      }
    }

    return { sendEnter: false };
  }
}
