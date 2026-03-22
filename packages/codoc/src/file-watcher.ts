import fs from "node:fs";
import { type FSWatcher as ChokidarFSWatcher, watch as chokidarWatch } from "chokidar";

export type FileChangeCallback = (filePath: string, newContent: string) => void;

interface WatchEntry {
  watcher: ChokidarFSWatcher;
  callbacks: FileChangeCallback[];
}

export class FileWatcher {
  private watchers: Map<string, WatchEntry>;

  constructor() {
    this.watchers = new Map();
  }

  watch(filePath: string, callback: FileChangeCallback): void {
    const existing = this.watchers.get(filePath);
    if (existing) {
      existing.callbacks.push(callback);
      return;
    }

    const watcher = chokidarWatch(filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    const entry: WatchEntry = { watcher, callbacks: [callback] };

    watcher.on("change", () => {
      try {
        const newContent = fs.readFileSync(filePath, "utf-8");
        for (const cb of entry.callbacks) {
          cb(filePath, newContent);
        }
      } catch {
        // file read error during change
      }
    });

    this.watchers.set(filePath, entry);
  }

  addOneTimeListener(filePath: string, callback: FileChangeCallback): void {
    const existing = this.watchers.get(filePath);
    if (!existing) {
      this.watch(filePath, callback);
      return;
    }

    const wrappedCallback: FileChangeCallback = (fp: string, content: string) => {
      this.removeCallback(filePath, wrappedCallback);
      callback(fp, content);
    };
    existing.callbacks.push(wrappedCallback);
  }

  removeCallback(filePath: string, callback: FileChangeCallback): void {
    const existing = this.watchers.get(filePath);
    if (!existing) return;
    existing.callbacks = existing.callbacks.filter((cb) => cb !== callback);
  }

  unwatch(filePath: string): void {
    const entry = this.watchers.get(filePath);
    if (entry) {
      entry.watcher.close();
      this.watchers.delete(filePath);
    }
  }

  async close(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [, entry] of this.watchers) {
      promises.push(entry.watcher.close());
    }
    await Promise.all(promises);
    this.watchers.clear();
  }
}
