// Bounded text ring buffer (design D4, task 5.2): keeps the last `maxBytes`
// of appended text so a start-up error message can show "the tail of its
// stderr" without holding an unbounded amount of agent output in memory.
export class RingBuffer {
  private buffer = "";

  constructor(private readonly maxBytes = 64 * 1024) {}

  push(text: string): void {
    if (text.length === 0) return;
    this.buffer += text;
    if (this.buffer.length > this.maxBytes) {
      this.buffer = this.buffer.slice(this.buffer.length - this.maxBytes);
    }
  }

  /** The last `maxLines` lines of the buffer, oldest first. */
  tail(maxLines = 200): string {
    const lines = this.buffer.split("\n");
    return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
  }

  get length(): number {
    return this.buffer.length;
  }
}
