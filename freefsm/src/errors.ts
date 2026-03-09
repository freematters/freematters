export interface CliErrorContext {
  runId?: string;
  state?: string;
}

export class CliError extends Error {
  code: string;
  data?: Record<string, unknown>;
  context: CliErrorContext;

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
  }

  formatHuman(): string {
    const [firstLine, ...rest] = this.message.split("\n");
    const lines = [`Error: ${firstLine}`];
    if (this.context.runId) lines.push(`run_id: ${this.context.runId}`);
    if (this.context.state) lines.push(`state: ${this.context.state}`);
    if (rest.length > 0) lines.push(...rest);
    return lines.join("\n");
  }
}
