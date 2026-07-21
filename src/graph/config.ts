import { resolve } from "node:path";
import { loadEnvFile } from "../config/env.js";

export interface GraphEnvConfig {
  clientId: string;
  tenantId: string;
  scopes: string[];
  mailbox: string;
  tokenCachePath: string;
  statePath: string;
}

const DEFAULT_SCOPES = ["Mail.Read", "Mail.ReadWrite", "offline_access"];
const DEFAULT_MAILBOX = "user@example.com";

export function resolveGraphConfig(cwd = process.cwd()): GraphEnvConfig {
  const fileVars = loadEnvFile(resolve(cwd, ".env"));
  const get = (key: string, fallback = ""): string =>
    process.env[key] ?? fileVars[key] ?? fallback;

  const clientId = get("GRAPH_CLIENT_ID");
  if (!clientId) {
    throw new Error("Missing GRAPH_CLIENT_ID in environment or .env");
  }

  const scopesRaw = get("GRAPH_SCOPES");
  const scopes = scopesRaw
    ? scopesRaw.split(/[\s,]+/).filter(Boolean)
    : DEFAULT_SCOPES;

  return {
    clientId,
    tenantId: get("GRAPH_TENANT_ID", "organizations"),
    scopes,
    mailbox: get("GRAPH_MAILBOX", DEFAULT_MAILBOX),
    tokenCachePath: resolve(cwd, get("GRAPH_TOKEN_CACHE", ".graph-token.json")),
    statePath: resolve(cwd, get("PIPELINE_STATE_PATH", ".pipeline-state.json")),
  };
}
