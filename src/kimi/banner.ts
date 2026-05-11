/**
 * Kimi CLI 배너 필터 — 기본 웰컴 배너를 키미캣 커스텀 배너로 교체
 *
 * node-pty 스트림에서 Kimi CLI의 기본 배너 블록을 감지하고,
 * Directory / Session / Model 메타 정보를 추출한 뒤
 * omk 테마의 커스텀 배너로 대체 출력합니다.
 */

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

export interface BannerMeta {
  directory?: string;
  session?: string;
  model?: string;
}

type ReplacerState = "buffering" | "passthrough" | "replaced";

export class BannerReplacer {
  private state: ReplacerState = "buffering";
  private chunks: string[] = [];
  private strippedCache = "";
  private cacheDirty = true;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private readonly MAX_LINES = 60; // banner may include model info / ascii art
  private readonly TIMEOUT_MS = 800; // allow slower terminals / ssh latency
  private readonly MAX_BYTES = 16384; // accommodate larger ascii art banners

  constructor(private onReplace: (meta: BannerMeta) => void) {}

  private get buffer(): string {
    return this.chunks.join("");
  }

  private getStripped(): string {
    if (this.cacheDirty) {
      this.strippedCache = stripAnsi(this.buffer);
      this.cacheDirty = false;
    }
    return this.strippedCache;
  }

  /** 데이터 청크를 받아 배너 교체 또는 그대로 통과시킴 */
  process(data: string): string | null {
    if (this.state === "replaced") {
      const stripped = this.stripKimiBanner(data);
      return stripped.length > 0 ? stripped : null;
    }
    if (this.state === "passthrough") {
      return data;
    }

    data = this.passthroughTerminalSetupPrefix(data);
    if (data.length === 0) return null;

    if (this.timeout === null) {
      this.startTimeout();
    }

    this.chunks.push(data);
    this.cacheDirty = true;

    const buf = this.buffer;

    if (buf.length > this.MAX_BYTES) {
      return this.flushPassthrough();
    }

    const lineCount = this.countLines(buf);
    if (lineCount > this.MAX_LINES) {
      return this.flushPassthrough();
    }

    const clean = this.getStripped();
    if (this.isBannerComplete(clean)) {
      return this.flushReplace();
    }

    if (!this.shouldContinueBuffering(clean)) {
      return this.flushPassthrough();
    }

    return null;
  }

  /** 타임아웃 등으로 인한 강제 플러시 */
  forceFlush(): string | null {
    this.clearTimeout();
    if (this.state === "buffering") {
      return this.flushPassthrough();
    }
    return null;
  }

  private startTimeout(): void {
    this.clearTimeout();
    this.timeout = setTimeout(() => {
      if (this.state === "buffering") {
        const rest = this.flushPassthrough();
        if (rest !== null) {
          process.stdout.write(rest);
        }
      }
    }, this.TIMEOUT_MS);
  }

  private clearTimeout(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  private countLines(buf: string): number {
    if (buf.length === 0) return 0;
    return buf.split(/\r?\n/).length;
  }

  private passthroughTerminalSetupPrefix(data: string): string {
    let rest = data;

    while (rest.length > 0) {
      const altScreenMatch = rest.match(/^(\x1b\[\?1049[hl])/);
      if (altScreenMatch) {
        // Drop alternate-screen-buffer sequences so the terminal
        // scrollback remains visible instead of being hidden.
        rest = rest.slice(altScreenMatch[1].length);
        continue;
      }
      const setupMatch = rest.match(/^(\x1b\[(?:\?25[hl]|[0-9;]*[Hf]|[0-9;]*[JK]|2K))/);
      const resetMatch = rest.match(/^(\x1bc)/);
      const charsetMatch = rest.match(/^(\x1b\([A-Za-z0-9])/);
      const match = setupMatch ?? resetMatch ?? charsetMatch;
      if (!match) break;
      process.stdout.write(match[1]);
      rest = rest.slice(match[1].length);
    }

    return rest;
  }

  private shouldContinueBuffering(clean: string): boolean {
    const trimmed = clean.trim();
    if (trimmed.length === 0) return true;
    if (this.hasWelcomeLine(clean) || this.hasMetaLines(clean)) return true;
    // Prompt-like lines should pass through immediately.
    if (/^kimi❯/.test(trimmed)) return false;
    if (clean.split(/\r?\n/).some((line) => /^kimi❯/.test(line.trim()))) return false;
    // Keep buffering when box frame is detected but welcome/meta text
    // hasn't arrived yet — process() will trigger replacement when complete.
    if (this.hasCompleteBox(clean)) return true;
    return true;
  }

  /** 버퍼에 Kimi CLI 배너 시그널과 배너 상단(╭)/하단(╰)이 모두 존재하면 완료로 판단 */
  private isBannerComplete(clean: string): boolean {
    const hasWelcome = this.hasWelcomeLine(clean);
    const hasMeta = this.hasMetaLines(clean);
    if (!hasWelcome && !hasMeta) {
      return false;
    }

    // Require the box frame to confirm we have the full banner block.
    return this.hasCompleteBox(clean);
  }

  private hasWelcomeLine(clean: string): boolean {
    // Broad match: any Kimi CLI welcome / branding line
    return /Welcome\s+to\s+Kimi/i.test(clean)
      || /\bKimi\s+(?:Code\s+)?CLI\b/i.test(clean)
      || /\bKimi\b.*\b(?:Code|CLI|Chat)\b/i.test(clean);
  }

  private hasMetaLines(clean: string): boolean {
    return /Directory:|Session:|Model:/.test(clean);
  }

  private hasCompleteBox(clean: string): boolean {
    const lines = clean.split(/\r?\n/);
    const topChars = ["╭", "╔", "┌", "▛", "┏"];
    const bottomChars = ["╰", "╚", "└", "▙", "┗"];
    let sawTop = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!sawTop && topChars.some((c) => trimmed.startsWith(c))) {
        sawTop = true;
        continue;
      }
      if (sawTop && bottomChars.some((c) => trimmed.startsWith(c))) {
        return true;
      }
    }
    return false;
  }

  private flushReplace(): string | null {
    if (this.state !== "buffering") return null;
    this.state = "replaced";
    this.clearTimeout();

    const meta = this.extractMeta(this.buffer);
    this.onReplace(meta);

    let after = this.extractAfterBanner(this.buffer);
    if (after === null) {
      after = this.stripKimiBanner(this.buffer);
    } else {
      // Also strip any trailing banner fragments that may have been buffered
      after = this.stripKimiBanner(after);
    }
    this.chunks = [];
    this.cacheDirty = true;
    return after.length > 0 ? after : null;
  }

  private flushPassthrough(): string | null {
    if (this.state !== "buffering") return null;
    this.state = "passthrough";
    this.clearTimeout();

    let result = this.stripKimiBanner(this.buffer);
    result = this.stripKimiBanner(result);
    this.chunks = [];
    this.cacheDirty = true;
    return result.length > 0 ? result : null;
  }

  private extractMeta(_buf: string): BannerMeta {
    const meta: BannerMeta = {};
    const clean = this.getStripped();
    for (const line of clean.split(/\r?\n/)) {
      const stripped = line.replace(/[│║┃╔╗╚╝╭╮╰╯─═]/g, "").trim();
      const dirMatch = stripped.match(/Directory:\s*(.+)/);
      if (dirMatch) meta.directory = dirMatch[1].trim();
      const sesMatch = stripped.match(/Session:\s*(.+)/);
      if (sesMatch) meta.session = sesMatch[1].trim();
      const modelMatch = stripped.match(/Model:\s*(.+)/);
      if (modelMatch) meta.model = modelMatch[1].trim();
    }
    return meta;
  }

  /** 배너 하단(╰─) 이후의 데이터만 추출 */
  private extractAfterBanner(buf: string): string | null {
    const origLines = buf.split(/\r?\n/);
    const cleanLines = this.getStripped().split(/\r?\n/);
    const bottomChars = ["╰", "╚", "└", "▙", "┗"];
    let endIdx = -1;

    for (let i = 0; i < cleanLines.length; i++) {
      const trimmed = cleanLines[i].trim();
      if (bottomChars.some((c) => trimmed.startsWith(c) || trimmed.includes(c + "─"))) {
        if (!bottomChars.some((_c) => trimmed.includes("╭") || trimmed.includes("╔") || trimmed.includes("┌"))) {
          endIdx = i;
          break;
        }
      }
    }

    if (endIdx === -1) return null;

    const after = origLines.slice(endIdx + 1);
    const result = after.join("\n");
    return result.length > 0 ? result : null;
  }

  /**
   * Fallback banner stripper: removes the Kimi CLI default banner block
   * (╭...╰) when the precise extractAfterBanner fails or we timeout.
   */
  private stripKimiBanner(buf: string): string {
    const lines = buf.split(/\r?\n/);
    const topChars = ["╭", "╔", "┌", "▛", "┏"];
    const bottomChars = ["╰", "╚", "└", "▙", "┗"];
    let startIdx = -1;
    let endIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const stripped = stripAnsi(lines[i]).trim();
      if (startIdx === -1 && topChars.some((c) => stripped.startsWith(c) || stripped.includes(c + "─"))) {
        startIdx = i;
      }
      if (startIdx !== -1 && bottomChars.some((c) => stripped.startsWith(c) || stripped.includes(c + "─"))) {
        if (!topChars.some((c) => stripped.includes(c))) {
          endIdx = i;
          break;
        }
      }
    }

    if (startIdx !== -1 && endIdx !== -1 && this.looksLikeKimiBanner(lines, startIdx, endIdx)) {
      return lines.slice(0, startIdx).concat(lines.slice(endIdx + 1)).join("\n");
    }

    return buf;
  }

  private looksLikeKimiBanner(lines: string[], start: number, end: number): boolean {
    const block = lines.slice(start, end + 1).join("\n");
    const clean = stripAnsi(block);
    return /Welcome\s+to\s+Kimi/i.test(clean)
      || /\bKimi\s+(?:Code\s+)?CLI\b/i.test(clean)
      || (/Directory:/.test(clean) && /Session:/.test(clean));
  }
}
