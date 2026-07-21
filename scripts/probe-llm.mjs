/**
 * Quick probe for the internal OpenAI-compatible Messages API.
 * Usage: node scripts/probe-llm.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");

function loadEnv(path) {
  const vars = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    vars[key] = val;
  }
  return vars;
}

const env = loadEnv(envPath);
const apiKey = env.LLM_API_KEY ?? env["x-api-key"];
const baseUrl = env.LLM_BASE_URL ?? "https://api.openai.com";
const apiPath = env.LLM_API_PATH ?? "/v1/chat/completions";
const model = env.LLM_MODEL ?? "claude-DeepSeek-V4-Flash[1M]";

if (!apiKey) {
  console.error("No API key found in .env (set LLM_API_KEY or x-api-key)");
  process.exit(1);
}

const url = `${baseUrl.replace(/\/$/, "")}${apiPath}`;
const body = {
  model,
  max_tokens: 50,
  messages: [{ role: "user", content: "Reply with exactly one word: OK" }],
};

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
  },
  body: JSON.stringify(body),
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
try {
  console.log(JSON.stringify(JSON.parse(text), null, 2));
} catch {
  console.log(text);
}
