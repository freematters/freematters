import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface TokenEntry {
  token: string;
  filePath: string;
  readonly: boolean;
  readonlyToken?: string;
  createdAt: number;
}

export interface RegisterResult {
  token: string;
  readonlyToken?: string;
}

export class TokenStore {
  private tokens: Map<string, TokenEntry>;
  private fileToToken: Map<string, string>;
  private primaryPath: string;
  private fallbackPath: string;
  private activePath: string;

  constructor(primaryPath: string) {
    this.primaryPath = primaryPath;
    this.fallbackPath = path.join(process.cwd(), ".codoc", "tokens.json");
    this.activePath = primaryPath;
    this.tokens = new Map();
    this.fileToToken = new Map();
    this.load();
  }

  register(filePath: string, readonly: boolean): RegisterResult {
    const absPath = path.resolve(filePath);
    const existing = this.fileToToken.get(absPath);
    if (existing) {
      const entry = this.tokens.get(existing) as TokenEntry;
      if (readonly && !entry.readonlyToken) {
        const roToken = crypto.randomBytes(12).toString("hex");
        entry.readonlyToken = roToken;
        const roEntry: TokenEntry = {
          token: roToken,
          filePath: absPath,
          readonly: true,
          createdAt: Date.now(),
        };
        this.tokens.set(roToken, roEntry);
        this.save();
      }
      return { token: entry.token, readonlyToken: entry.readonlyToken };
    }

    const token = crypto.randomBytes(12).toString("hex");
    const entry: TokenEntry = {
      token,
      filePath: absPath,
      readonly: false,
      createdAt: Date.now(),
    };

    if (readonly) {
      const roToken = crypto.randomBytes(12).toString("hex");
      entry.readonlyToken = roToken;
      const roEntry: TokenEntry = {
        token: roToken,
        filePath: absPath,
        readonly: true,
        createdAt: Date.now(),
      };
      this.tokens.set(roToken, roEntry);
    }

    this.tokens.set(token, entry);
    this.fileToToken.set(absPath, token);
    this.save();
    return { token, readonlyToken: entry.readonlyToken };
  }

  resolve(token: string): TokenEntry | null {
    return this.tokens.get(token) ?? null;
  }

  revoke(token: string): void {
    const entry = this.tokens.get(token);
    if (entry) {
      this.fileToToken.delete(entry.filePath);
      this.tokens.delete(token);
      if (entry.readonlyToken) {
        this.tokens.delete(entry.readonlyToken);
      }
      this.save();
    }
  }

  list(): TokenEntry[] {
    return Array.from(this.tokens.values()).filter((e) => !e.readonly);
  }

  private loadFrom(filePath: string): void {
    try {
      const data = fs.readFileSync(filePath, "utf-8");
      const entries: TokenEntry[] = JSON.parse(data);
      for (const entry of entries) {
        if (!this.tokens.has(entry.token)) {
          this.tokens.set(entry.token, entry);
          if (!entry.readonly && !this.fileToToken.has(entry.filePath)) {
            this.fileToToken.set(entry.filePath, entry.token);
          }
        }
      }
    } catch {
      // File doesn't exist or is invalid — skip
    }
  }

  private load(): void {
    this.loadFrom(this.primaryPath);
    if (this.fallbackPath !== this.primaryPath) {
      this.loadFrom(this.fallbackPath);
    }
  }

  private tryWrite(filePath: string, data: string): boolean {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, data);
      return true;
    } catch {
      return false;
    }
  }

  private save(): void {
    const data = JSON.stringify(Array.from(this.tokens.values()), null, 2);
    if (this.tryWrite(this.activePath, data)) {
      return;
    }
    if (
      this.activePath !== this.fallbackPath &&
      this.tryWrite(this.fallbackPath, data)
    ) {
      this.activePath = this.fallbackPath;
      return;
    }
  }
}
