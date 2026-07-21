import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface PipelineState {
  /** Graph delta token; undefined = initial sync. */
  deltaToken?: string;
  /** Message IDs already processed (dedup across restarts). */
  processedIds: string[];
}

export class PipelineStateStore {
  constructor(private readonly path: string) {}

  load(): PipelineState {
    if (!existsSync(this.path)) {
      return { processedIds: [] };
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as PipelineState;
      return { deltaToken: raw.deltaToken, processedIds: raw.processedIds ?? [] };
    } catch {
      return { processedIds: [] };
    }
  }

  save(state: PipelineState): void {
    writeFileSync(this.path, JSON.stringify(state, null, 2), "utf8");
  }
}
