/**
 * DualStreamLogger — visually distinguishable logging for embedded, verifier, and input streams.
 * All output goes to stderr.
 */

import { colors } from "../agent-log.js";

const INDENT = "    ";

export class DualStreamLogger {
  /** Log embedded agent output: [embedded] prefix, cyan, indented */
  logEmbedded(text: string): void {
    const lines = text.split("\n");
    const formatted = lines
      .map(
        (line) =>
          `${INDENT}${colors.cyan}[embedded]${colors.reset} ${colors.cyan}${line}${colors.reset}`,
      )
      .join("\n");
    process.stderr.write(`${formatted}\n`);
  }

  /** Log verifier agent output: [verifier] prefix, green, top level */
  logVerifier(text: string): void {
    process.stderr.write(
      `${colors.green}[verifier]${colors.reset} ${colors.green}${text}${colors.reset}\n`,
    );
  }

  /** Log input sent to embedded agent: [input] prefix, magenta, top level */
  logInput(text: string): void {
    process.stderr.write(
      `${colors.magenta}[input]${colors.reset} ${colors.magenta}${text}${colors.reset}\n`,
    );
  }
}
