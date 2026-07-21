import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AuditLogEntry } from "../types/index.js";
import type { AuditLogStore, ErrorChannel } from "./index.js";

function appendJsonLine(path: string, obj: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(obj)}\n`, "utf8");
}

export class FileAuditLogStore implements AuditLogStore {
  constructor(private readonly path: string) {}

  append(entry: AuditLogEntry): void {
    appendJsonLine(this.path, entry);
  }
}

export class FileErrorChannel implements ErrorChannel {
  constructor(private readonly path: string) {}

  record(entry: AuditLogEntry, error: string): void {
    appendJsonLine(this.path, { entry, error, at: new Date().toISOString() });
  }
}
