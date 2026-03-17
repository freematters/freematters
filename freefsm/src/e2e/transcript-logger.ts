import { createWriteStream, openSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type TranscriptEntryType = "action" | "observation" | "judgment" | "error";

export interface TranscriptEntry {
  ts: string;
  type: TranscriptEntryType;
  step: number;
  content: string;
  evidence?: string;
}

export interface ApiLogEntry {
  ts: string;
  direction: "request" | "response";
  data: unknown;
}

/**
 * Captures all agent interactions with timestamps for reproducibility.
 * Writes two JSONL files:
 *   - transcript.jsonl: structured log of actions, observations, judgments
 *   - api.jsonl: raw Claude API request/response pairs
 *
 * Uses fs.createWriteStream (opened via a pre-created fd for immediate
 * availability) so that writes do not block the event loop.
 */
export class TranscriptLogger {
  private readonly transcriptPath: string;
  private readonly apiPath: string;
  private readonly transcriptStream: WriteStream;
  private readonly apiStream: WriteStream;
  private currentStep = 0;
  private closed = false;

  constructor(testDir: string) {
    this.transcriptPath = join(testDir, "transcript.jsonl");
    this.apiPath = join(testDir, "api.jsonl");
    // Open file descriptors synchronously so the streams are ready immediately
    const transcriptFd = openSync(this.transcriptPath, "w");
    const apiFd = openSync(this.apiPath, "w");
    this.transcriptStream = createWriteStream(this.transcriptPath, {
      fd: transcriptFd,
      encoding: "utf-8",
    });
    this.apiStream = createWriteStream(this.apiPath, {
      fd: apiFd,
      encoding: "utf-8",
    });
  }

  /** Set the current step number for subsequent transcript entries. */
  setStep(step: number): void {
    this.currentStep = step;
  }

  /** Append a structured entry to transcript.jsonl. */
  logTranscript(entry: Omit<TranscriptEntry, "ts"> & { ts?: string }): void {
    const full: TranscriptEntry = {
      ts: entry.ts ?? new Date().toISOString(),
      type: entry.type,
      step: entry.step,
      content: entry.content,
      ...(entry.evidence !== undefined && { evidence: entry.evidence }),
    };
    this.transcriptStream.write(`${JSON.stringify(full)}\n`);
  }

  /** Append a raw API request/response entry to api.jsonl. */
  logApi(entry: Omit<ApiLogEntry, "ts">): void {
    const full: ApiLogEntry = {
      ts: new Date().toISOString(),
      direction: entry.direction,
      data: entry.data,
    };
    this.apiStream.write(`${JSON.stringify(full)}\n`);
  }

  /**
   * Process an SDK message from the Agent SDK stream.
   * Logs relevant messages to transcript.jsonl and api.jsonl.
   */
  processMessage(message: SDKMessage): void {
    switch (message.type) {
      case "assistant": {
        const msg = message as {
          type: "assistant";
          message: { content: Array<{ type: string; text?: string }> };
          uuid: string;
        };
        const textParts = msg.message.content
          .filter((c) => c.type === "text" && c.text)
          .map((c) => c.text as string);
        if (textParts.length > 0) {
          this.logTranscript({
            type: "observation",
            step: this.currentStep,
            content: textParts.join("\n"),
          });
        }
        // Log as API response
        this.logApi({ direction: "response", data: msg.message });
        break;
      }

      case "result": {
        const msg = message as {
          type: "result";
          subtype?: string;
          result?: string;
          is_error?: boolean;
          duration_ms?: number;
          num_turns?: number;
        };
        const entryType: TranscriptEntryType = msg.is_error ? "error" : "judgment";
        this.logTranscript({
          type: entryType,
          step: this.currentStep,
          content: msg.result ?? `Session ended (${msg.subtype})`,
          evidence: msg.duration_ms
            ? `duration=${msg.duration_ms}ms, turns=${msg.num_turns ?? 0}`
            : undefined,
        });
        break;
      }

      // stream_event, status, and other message types are ignored for transcript
      default:
        break;
    }
  }

  /** Flush and close the write streams. Resolves when both are fully drained. */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;

    return new Promise<void>((resolve, reject) => {
      let pending = 2;
      const onDone = () => {
        pending--;
        if (pending === 0) resolve();
      };
      const onError = (err: Error) => reject(err);

      this.transcriptStream.end(onDone);
      this.transcriptStream.on("error", onError);
      this.apiStream.end(onDone);
      this.apiStream.on("error", onError);
    });
  }
}
