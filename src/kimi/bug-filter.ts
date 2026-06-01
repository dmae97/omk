function stripAnsi(str: string): string {
  if (!str.includes("\x1b")) return str;
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

/** Map a position in stripped text back to the corresponding position in the original text. */
function strippedToOriginal(original: string, strippedIndex: number): number {
  let origIdx = 0;
  let stripIdx = 0;

  while (stripIdx < strippedIndex && origIdx < original.length) {
    if (
      original.charCodeAt(origIdx) === 0x1b &&
      origIdx + 1 < original.length &&
      original.charCodeAt(origIdx + 1) === 0x5b
    ) {
      const seqStart = origIdx;
      origIdx += 2;
      // Match [0-9;]* — digits and semicolons only
      while (origIdx < original.length) {
        const code = original.charCodeAt(origIdx);
        if ((code >= 0x30 && code <= 0x39) || code === 0x3b) {
          origIdx++;
        } else {
          break;
        }
      }
      // Now check for [A-Za-z] terminator
      if (origIdx < original.length) {
        const code = original.charCodeAt(origIdx);
        if ((code >= 0x40 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
          origIdx++; // skip terminator, sequence fully matched
          continue;
        }
      }
      // Not a matching sequence; treat ESC as a regular character
      origIdx = seqStart + 1;
      stripIdx++;
    } else {
      origIdx++;
      stripIdx++;
    }
  }
  return origIdx;
}

const START_MARKER = "Unhandled exception in event loop:";
const END_MARKER = "Press ENTER to continue...";

export class KimiBugFilter {
  private state: "idle" | "in_bug" = "idle";
  private buffer = "";
  private readonly BUG_LIMIT = 1024;

  process(chunk: string): { output: string | null; sendEnter: boolean } {
    if (this.state === "idle") {
      return this.processIdle(chunk);
    }
    this.buffer += chunk;
    return this.processInBug();
  }

  private processIdle(chunk: string): { output: string | null; sendEnter: boolean } {
    this.buffer += chunk;
    const stripped = stripAnsi(this.buffer);

    const startIdx = stripped.indexOf(START_MARKER);
    if (startIdx !== -1) {
      const origStart = strippedToOriginal(this.buffer, startIdx);
      const beforeBug = this.buffer.slice(0, origStart);
      this.buffer = this.buffer.slice(origStart);
      this.state = "in_bug";
      const result = this.processInBug();
      const before = beforeBug.length > 0 ? beforeBug : "";
      const after = result.output ?? "";
      const combined = before + after;
      return {
        output: combined.length > 0 ? combined : null,
        sendEnter: result.sendEnter,
      };
    }

    // Only hold back bytes that could be a prefix of START_MARKER.
    // This eliminates the fixed 38-byte tail lag that caused typing delay.
    const keep = this.splitKeepBytes(stripped);
    if (this.buffer.length > keep) {
      const flushed = keep === 0 ? this.buffer : this.buffer.slice(0, -keep);
      this.buffer = keep === 0 ? "" : this.buffer.slice(-keep);
      return { output: flushed.length > 0 ? flushed : null, sendEnter: false };
    }

    return { output: null, sendEnter: false };
  }

  /** Compute how many raw bytes to retain because they may be a split START_MARKER prefix. */
  private splitKeepBytes(stripped: string): number {
    const maxLen = Math.min(stripped.length, START_MARKER.length - 1);
    for (let len = maxLen; len > 0; len--) {
      if (stripped.endsWith(START_MARKER.slice(0, len))) {
        const strippedStart = stripped.length - len;
        const rawStart = strippedToOriginal(this.buffer, strippedStart);
        return this.buffer.length - rawStart;
      }
    }
    return 0;
  }

  /** Flush any remaining buffered data. Called on PTY exit. */
  forceFlush(): string | null {
    if (this.state === "idle") {
      const flushed = this.buffer;
      this.buffer = "";
      return flushed.length > 0 ? flushed : null;
    }
    // Try to finish any in-progress bug extraction
    const result = this.processInBug();
    if (result.output !== null) {
      return result.output;
    }
    const flushed = this.buffer;
    this.buffer = "";
    this.state = "idle";
    return flushed.length > 0 ? flushed : null;
  }

  private processInBug(): { output: string | null; sendEnter: boolean } {
    const stripped = stripAnsi(this.buffer);

    if (!stripped.includes(END_MARKER)) {
      if (this.buffer.length > this.BUG_LIMIT) {
        const flushed = this.buffer;
        this.buffer = "";
        this.state = "idle";
        return { output: flushed.length > 0 ? flushed : null, sendEnter: false };
      }
      return { output: null, sendEnter: false };
    }

    const regex =
      /Unhandled exception in event loop:\s*(?:\n\s*)*Exception None\s*(?:\n\s*)*Press ENTER to continue\.\.\.\s*\n?/g;
    let match: RegExpExecArray | null;
    let lastEndOrig = 0;
    let sendEnter = false;
    const parts: string[] = [];

    while ((match = regex.exec(stripped)) !== null) {
      const origStart = strippedToOriginal(this.buffer, match.index);
      const origEnd = strippedToOriginal(
        this.buffer,
        match.index + match[0].length
      );
      parts.push(this.buffer.slice(lastEndOrig, origStart));
      lastEndOrig = origEnd;
      sendEnter = true;
    }

    parts.push(this.buffer.slice(lastEndOrig));
    const remaining = parts.join("");

    const remainingStripped = stripAnsi(remaining);
    if (remainingStripped.includes(START_MARKER)) {
      this.buffer = remaining;
      this.state = "in_bug";
      return { output: null, sendEnter };
    }

    this.buffer = remaining;
    this.state = "idle";
    return { output: remaining.length > 0 ? remaining : null, sendEnter };
  }
}
