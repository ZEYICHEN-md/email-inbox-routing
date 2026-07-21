import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface CachedTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
}

export class TokenCache {
  constructor(private readonly path: string) {}

  load(): CachedTokens | undefined {
    if (!existsSync(this.path)) return undefined;
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as CachedTokens;
    } catch {
      return undefined;
    }
  }

  save(tokens: CachedTokens): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(tokens, null, 2), "utf8");
  }

  clear(): void {
    if (existsSync(this.path)) writeFileSync(this.path, "{}", "utf8");
  }
}
