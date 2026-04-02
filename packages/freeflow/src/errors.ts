export interface CliErrorContext {
  runId?: string;
  state?: string;
  fsmPath?: string;
}

export class CliError extends Error {
  code: string;
  data?: Record<string, unknown>;
  context: CliErrorContext;
  timestamp: string;

  constructor(
    code: string,
    message: string,
    opts?: { data?: Record<string, unknown>; context?: CliErrorContext },
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.data = opts?.data;
    this.context = opts?.context ?? {};
    this.timestamp = new Date().toISOString();
  }

  formatHuman(): string {
    const [firstLine, ...rest] = this.message.split("\n");
    const lines = [`Error [${this.code}]: ${firstLine}`];
    if (this.context.runId) lines.push(`  run_id: ${this.context.runId}`);
    if (this.context.state) lines.push(`  state: ${this.context.state}`);
    if (this.context.fsmPath) lines.push(`  fsm: ${this.context.fsmPath}`);
    if (rest.length > 0) lines.push(...rest);
    return lines.join("\n");
  }

  static assertNotMarkdown(meta: { markdown?: boolean }, runId: string): void {
    if (meta.markdown) {
      throw new CliError(
        "MARKDOWN_MODE",
        `Run "${runId}" is in markdown mode — state tracking is disabled.`,
        { context: { runId } },
      );
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      data: this.data ?? null,
    };
  }
}
