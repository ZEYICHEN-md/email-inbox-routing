import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export interface LlmEnvConfig {
  baseUrl: string;
  apiPath: string;
  apiKey: string;
  model: string;
  apiStyle?: "messages" | "chat";
}

const DEFAULT_BASE_URL = "https://api.openai.com";
/** Cheaper default: OpenAI-compatible chat/completions + DeepSeek Flash. */
const DEFAULT_API_PATH = "/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

/** Loads key/value pairs from a `.env` file (no external dependency). */
export function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

/** Resolves LLM settings from process.env, optionally merged with a `.env` file. */
export function resolveLlmConfig(envPath?: string): LlmEnvConfig {
  const fileVars = envPath ? loadEnvFile(envPath) : loadEnvFile(resolve(process.cwd(), ".env"));
  const get = (key: string, fallback = ""): string =>
    process.env[key] ?? fileVars[key] ?? fallback;

  const apiKey = get("LLM_API_KEY") || get("x-api-key");
  if (!apiKey) {
    throw new Error("Missing LLM_API_KEY (or x-api-key) in environment or .env");
  }

  const apiStyleRaw = get("LLM_API_STYLE");
  const apiStyle =
    apiStyleRaw === "messages" || apiStyleRaw === "chat" ? apiStyleRaw : undefined;

  return {
    baseUrl: get("LLM_BASE_URL", DEFAULT_BASE_URL),
    apiPath: get("LLM_API_PATH", DEFAULT_API_PATH),
    apiKey,
    model: get("LLM_MODEL", DEFAULT_MODEL),
    apiStyle,
  };
}
