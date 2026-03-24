import { closeSync, openSync, writeSync } from "node:fs";

const FRAMES = [
  "\u280B",
  "\u2819",
  "\u2839",
  "\u2838",
  "\u283C",
  "\u2834",
  "\u2826",
  "\u2827",
  "\u2807",
  "\u280F",
];
const INTERVAL = 80;
const MAX_WIDTH = 60;

export class Spinner {
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private text = "Thinking...";
  private lastLen = 0;
  private ttyFd: number | null = null;

  private ensureTty(): boolean {
    if (this.ttyFd !== null) return true;
    try {
      this.ttyFd = openSync("/dev/tty", "w");
      return true;
    } catch {
      return false;
    }
  }

  start(text?: string): void {
    if (text) this.text = text;
    if (this.timer) return;
    if (!this.ensureTty()) return;
    this.render();
    this.timer = setInterval(() => this.render(), INTERVAL);
  }

  update(text: string): void {
    this.text = text.length > MAX_WIDTH ? `${text.slice(0, MAX_WIDTH - 3)}...` : text;
  }

  /** Pause animation and clear the line, but keep the tty fd open. */
  pause(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.writeTty(`\r${" ".repeat(this.lastLen)}\r`);
    this.lastLen = 0;
  }

  /** Resume animation after pause. */
  resume(): void {
    if (this.timer) return;
    if (this.ttyFd === null) return;
    this.render();
    this.timer = setInterval(() => this.render(), INTERVAL);
  }

  /** Stop animation and clear the line. Keeps tty fd open for reuse. */
  stop(): void {
    this.pause();
  }

  /** Close the tty fd. Call once when done with the spinner. */
  destroy(): void {
    this.pause();
    if (this.ttyFd !== null) {
      try {
        closeSync(this.ttyFd);
      } catch {
        // fd already closed
      }
      this.ttyFd = null;
    }
  }

  get active(): boolean {
    return this.timer !== null;
  }

  private render(): void {
    const symbol = FRAMES[this.frame % FRAMES.length];
    const line = `${symbol} ${this.text}`;
    const pad =
      this.lastLen > line.length ? " ".repeat(this.lastLen - line.length) : "";
    this.writeTty(`\r\x1b[2m${line}${pad}\x1b[0m`);
    this.lastLen = line.length + pad.length;
    this.frame++;
  }

  private writeTty(data: string): void {
    if (this.ttyFd !== null) {
      try {
        writeSync(this.ttyFd, data);
      } catch {
        // TTY closed or unavailable
      }
    }
  }
}
